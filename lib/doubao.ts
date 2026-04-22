type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

function asRecord(x: unknown): Record<string, unknown> | null {
  return x && typeof x === "object" ? (x as Record<string, unknown>) : null;
}

function getErrorMessageFromApiPayload(data: unknown): string | null {
  const r = asRecord(data);
  if (!r) return null;
  const err = asRecord(r.error);
  const msg = err && typeof err.message === "string" ? err.message : null;
  return msg;
}

export function extractJsonFromText(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("未能从模型输出中提取 JSON");
  }
  const jsonStr = text.slice(start, end + 1);
  return JSON.parse(jsonStr);
}

export async function callDashscopeChatCompletion(params: {
  messages: ChatMessage[];
  model: string;
  apiKey?: string;
  baseUrl?: string;
}): Promise<string> {
  const apiKey = params.apiKey ?? process.env.AI_API_KEY;
  const baseUrl = params.baseUrl ?? process.env.AI_API_BASE_URL;
  if (!apiKey) throw new Error("缺少 AI_API_KEY");
  if (!baseUrl) throw new Error("缺少 AI_API_BASE_URL");

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: 0.2,
      // 兼容性考虑：有些兼容接口不支持 response_format
    }),
  });

  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    throw new Error(getErrorMessageFromApiPayload(data) || "调用 AI 失败");
  }

  const r = asRecord(data);
  const choices = r && Array.isArray(r.choices) ? r.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : null;
  const message = first ? asRecord(first.message) : null;
  const content = message?.content;
  if (typeof content !== "string") throw new Error("AI 返回内容格式异常");
  return content;
}

export async function callDashscopeChatCompletionStream(params: {
  messages: ChatMessage[];
  model: string;
  onDelta: (delta: string) => void;
  apiKey?: string;
  baseUrl?: string;
}): Promise<string> {
  const apiKey = params.apiKey ?? process.env.AI_API_KEY;
  const baseUrl = params.baseUrl ?? process.env.AI_API_BASE_URL;
  if (!apiKey) throw new Error("缺少 AI_API_KEY");
  if (!baseUrl) throw new Error("缺少 AI_API_BASE_URL");

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: 0.2,
      stream: true,
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as unknown;
    throw new Error(getErrorMessageFromApiPayload(data) || "调用 AI 失败");
  }

  if (!res.body) throw new Error("AI 流式响应为空");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const json = JSON.parse(payload) as unknown;
        const r = asRecord(json);
        const choices = r && Array.isArray(r.choices) ? r.choices : [];
        const first = choices[0] && typeof choices[0] === "object" ? (choices[0] as Record<string, unknown>) : null;
        const deltaObj = first ? asRecord(first.delta) : null;
        const delta = deltaObj?.content ?? (deltaObj as { reasoning_content?: unknown })?.reasoning_content;
        if (typeof delta === "string" && delta.length > 0) {
          full += delta;
          params.onDelta(delta);
        }
      } catch {
        // 忽略非 JSON 或中间脏行
      }
    }
  }

  return full.trim();
}

/**
 * 发起 OpenAI 兼容的流式 chat/completions，供路由透传或再加工。
 */
export async function fetchOpenAiChatCompletionsStream(params: {
  messages: ChatMessage[];
  model: string;
  temperature?: number;
  apiKey?: string;
  baseUrl?: string;
}): Promise<Response> {
  const apiKey = params.apiKey ?? process.env.AI_API_KEY;
  const baseUrl = params.baseUrl ?? process.env.AI_API_BASE_URL;
  if (!apiKey) throw new Error("缺少 AI_API_KEY");
  if (!baseUrl) throw new Error("缺少 AI_API_BASE_URL");

  const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      stream: true,
    }),
  });
}

export type NexmindChatDonePayload = {
  conversationId: string;
  /** 本轮用户消息在库中的 id，便于前端替换临时 client id */
  lastUserMessageId?: string;
  message: {
    id: string;
    role: "USER" | "ASSISTANT" | "SYSTEM";
    content: string;
    createdAt: string;
  };
};

export type NexmindChatStatusPayload = {
  phase: "llm_stream_started" | "persisting" | "completed";
  message: string;
};

/**
 * 透传上游 SSE 字节（去掉厂商自带的 data: [DONE]，以便在落库后追加 nexmind_done 与唯一 [DONE]）。
 * 同时从流中解析 choices[0].delta.content 拼出全文供 onComplete 写入数据库。
 */
export function pipeChatStreamPersistMetadata(
  source: ReadableStream<Uint8Array>,
  onComplete: (fullAssistantText: string) => Promise<NexmindChatDonePayload>
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuf = "";
  let accumulated = "";

  return new ReadableStream({
    async start(controller) {
      const reader = source.getReader();
      try {
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              nexmind_status: { phase: "llm_stream_started", message: "模型已开始生成..." } satisfies NexmindChatStatusPayload,
            })}\n\n`
          )
        );
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          lineBuf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = lineBuf.indexOf("\n")) >= 0) {
            const line = lineBuf.slice(0, nl);
            lineBuf = lineBuf.slice(nl + 1);

            const trimmed = line.trim();
            if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
              continue;
            }

            controller.enqueue(encoder.encode(line + "\n"));

            if (trimmed.startsWith("data:")) {
              const payload = trimmed.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const json = JSON.parse(payload) as {
                  choices?: { delta?: { content?: string } }[];
                  error?: { message?: string };
                };
                if (json?.error?.message) {
                  throw new Error(json.error.message);
                }
                const d = json?.choices?.[0]?.delta as { content?: string; reasoning_content?: string } | undefined;
                const delta = d?.content ?? d?.reasoning_content;
                if (typeof delta === "string") accumulated += delta;
              } catch (e) {
                if (e instanceof SyntaxError) continue;
                throw e;
              }
            }
          }
        }

        if (lineBuf.length > 0) {
          const trimmed = lineBuf.trim();
          if (trimmed !== "data: [DONE]" && trimmed !== "data:[DONE]") {
            controller.enqueue(encoder.encode(lineBuf));
          }
        }

        const full = accumulated.trim();
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              nexmind_status: { phase: "persisting", message: "正在保存回答..." } satisfies NexmindChatStatusPayload,
            })}\n\n`
          )
        );
        const meta = await onComplete(full || "");
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ nexmind_done: meta })}\n\n`)
        );
        controller.enqueue(
          encoder.encode(
            `data: ${JSON.stringify({
              nexmind_status: { phase: "completed", message: "回答完成" } satisfies NexmindChatStatusPayload,
            })}\n\n`
          )
        );
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      } catch (e) {
        const msg = e instanceof Error ? e.message : "生成失败";
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ error: { message: msg } })}\n\n`)
        );
        controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
        controller.close();
      }
    },
  });
}

export async function generateCaptureResult(inputText: string): Promise<{
  title: string;
  keyPoints: string[];
  tags: string[];
  cleanedContent: string;
}> {
  const model = process.env.AI_MODEL_SUMMARY || process.env.AI_MODEL_WRITER || process.env.AI_MODEL_CHAT || "doubao-seed-1-8";

  const system =
    "你是 NextClaw 工作台的高保真内容摄取 Agent。你的首要目标是保留信息完整性：仅删除广告、导航、推荐、版权提示与重复噪声，不可为了简洁而截断事实。必须输出严格 JSON，字段与类型要满足约束。";

  const user = `请对以下内容提取并整理为“结构化笔记（Markdown）”。必须输出严格 JSON，字段与类型要满足约束。\n\n要求：\n- title：一句话标题（中文为主）\n- keyPoints：3 条核心要点（每条不超过 100 字）\n- tags：建议标签数组（每个标签以 # 开头，长度 2~8）\n- cleanedContent：Markdown 正文（结构化排版），要求至少包含以下 4 个小标题：\n  1) ## 核心观点\n  2) ## 要点\n  3) ## 补充\n  4) ## 待办/建议\n- 不要省略关键事实，不要用“略”“同上”替代内容。\n\n输出示例：\n{\n  "title": "...",\n  "keyPoints": ["...","...","..."],\n  "tags": [\"#AI\",\"#技术\"],\n  "cleanedContent": \"## 核心观点\\n- ...\\n\\n## 要点\\n- ...\\n\\n## 补充\\n- ...\\n\\n## 待办/建议\\n- ...\"\n}\n\n---\n内容如下：\n${inputText.slice(0, 20000)}\n---`;

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = extractJsonFromText(raw) as unknown;
  const obj = asRecord(parsed);
  if (!obj || typeof obj.title !== "string" || !Array.isArray(obj.keyPoints) || !Array.isArray(obj.tags)) {
    throw new Error("AI 返回 JSON 结构不符合预期");
  }

  const keyPoints = (obj.keyPoints as unknown[])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 3);
  while (keyPoints.length < 3) keyPoints.push("（待补充要点）");

  const tags = (obj.tags as unknown[])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((x) => (x.startsWith("#") ? x : `#${x}`));

  const cleanedContent = String(obj.cleanedContent ?? "").trim();

  return {
    title: obj.title.trim() || "未命名笔记",
    keyPoints,
    tags,
    cleanedContent,
  };
}

function normalizeFolderName(x: unknown): string | null {
  if (typeof x !== "string") return null;
  const v = x.trim().replace(/[\/\\:*?"<>|]/g, "").replace(/\s+/g, " ");
  if (!v) return null;
  // 控制目录名长度，避免异常输出污染目录树
  return v.slice(0, 24);
}

export async function generateCaptureChunkNote(params: {
  globalTitle: string;
  globalTags: string[];
  chunkText: string;
  index: number;
  total: number;
  sourceUrl?: string;
}): Promise<{
  title: string;
  tags: string[];
  folder: string | null;
  markdown: string;
}> {
  const model = process.env.AI_MODEL_WRITER || process.env.AI_MODEL_CHAT || process.env.AI_MODEL_SUMMARY || "doubao-seed-1-8";

  const system =
    "你是 NextClaw 的知识整理 Agent。输入是“已清洗后的正文分片”，请输出可直接入库的 Markdown 笔记。结构应根据内容自适应，不要僵化套模板。必须严格只输出 JSON。禁止输出广告/导航/版权/目录等噪声。";

  const user = `请把下面分片整理为一篇“可读性强”的笔记。\n\n约束：\n- 只输出严格 JSON：{title:string, tags:string[], folder:string|null, markdown:string}\n- title：不要用“分片1/2”这种；要能概括此分片主题\n- tags：3~8 个，必须以 # 开头\n- folder：允许你自主命名主题目录（如“工程实践”“产品策略”“AI基础设施”等），不适合归类时可给 null\n- markdown：\n  - 采用“内容自适应结构”，使用 2~5 个二级标题即可，不强制固定栏目名\n  - 先给核心结论，再展开证据/机制/案例/边界条件（按内容择优）\n  - 保留关键事实，不凭空扩写\n- 输出不要包含“关注微信 / Copyright / 备案号 / 教程列表 / 下一篇”等噪声\n\n全局信息：\n- globalTitle: ${params.globalTitle}\n- globalTags: ${params.globalTags.join(" ")}\n- sourceUrl: ${params.sourceUrl ?? ""}\n- chunk: ${params.index + 1}/${params.total}\n\n---\n分片正文：\n${params.chunkText.slice(0, 9000)}\n---`;

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = extractJsonFromText(raw) as unknown;
  const obj = asRecord(parsed);
  if (!obj || typeof obj.title !== "string" || typeof obj.markdown !== "string" || !Array.isArray(obj.tags)) {
    throw new Error("AI 返回 JSON 结构不符合预期");
  }

  const tags = (obj.tags as unknown[])
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((x) => (x.startsWith("#") ? x : `#${x}`));
  const folder = normalizeFolderName(obj.folder) ?? null;
  const title = obj.title.trim() || `分片 ${params.index + 1}`;
  let markdown = String(obj.markdown ?? "").trim();
  // 兜底：若模型未输出层级结构，则补一个最小结构，避免可读性崩坏
  if (!/^##\s+/m.test(markdown)) {
    markdown = `## 核心内容\n${markdown || "（内容生成为空）"}`;
  }
  return { title, tags, folder, markdown };
}

export async function planCaptureChunking(params: {
  title: string;
  tags: string[];
  cleanedContent: string;
  rawText: string;
}): Promise<{
  targetChunks: number;
  preferredChunkChars: number;
  reason: string;
}> {
  const model = process.env.AI_MODEL_SUMMARY || process.env.AI_MODEL_CHAT || process.env.AI_MODEL_WRITER || "doubao-seed-1-8";
  const source = (params.cleanedContent || params.rawText || "").trim();
  if (!source) {
    return { targetChunks: 1, preferredChunkChars: 1800, reason: "empty_source_fallback" };
  }

  const system =
    "你是 NextClaw 的分片规划助手。任务是判断一篇材料应拆成几篇笔记，目标是语义完整且颗粒度适中。只输出严格 JSON。";
  const user = `请基于内容结构规划分片数量，不要仅按字数机械切分。

规则：
- 输出 JSON：{targetChunks:number, preferredChunkChars:number, reason:string}
- targetChunks 范围 1~8
- preferredChunkChars 范围 1200~3200
- 当主题层次多、论点转折多、案例段落多时，应增加 targetChunks
- 当内容线性单一、重复较多时，应减少 targetChunks
- 不要输出额外文本

上下文：
- title: ${params.title}
- tags: ${params.tags.join(" ")}
- cleanedChars: ${params.cleanedContent.length}
- rawChars: ${params.rawText.length}

正文片段（可能被截断）：
---
${source.slice(0, 14000)}
---`;

  try {
    const raw = await callDashscopeChatCompletion({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const parsed = extractJsonFromText(raw) as unknown;
    const obj = asRecord(parsed);
    const targetChunksRaw = Number(obj?.targetChunks ?? 0);
    const preferredCharsRaw = Number(obj?.preferredChunkChars ?? 0);
    const reason =
      typeof obj?.reason === "string" && obj.reason.trim()
        ? obj.reason.trim().slice(0, 120)
        : "ai_plan";

    const targetChunks = Number.isFinite(targetChunksRaw)
      ? Math.max(1, Math.min(8, Math.round(targetChunksRaw)))
      : 1;
    const preferredChunkChars = Number.isFinite(preferredCharsRaw)
      ? Math.max(1200, Math.min(3200, Math.round(preferredCharsRaw)))
      : 1800;
    return { targetChunks, preferredChunkChars, reason };
  } catch {
    // 回退：不阻断主流程
    const baseChars = Math.max(params.cleanedContent.length, params.rawText.length);
    const rough = Math.max(1, Math.min(8, Math.round(baseChars / 2200)));
    return {
      targetChunks: rough,
      preferredChunkChars: 1900,
      reason: "fallback_heuristic",
    };
  }
}

export async function generateChatToNoteResult(params: {
  conversationText: string;
  /** 仅勾选了部分消息时，提醒模型勿臆测未展示内容 */
  partialSelection?: boolean;
}): Promise<{
  title: string;
  markdown: string;
  tags: string[];
}> {
  const model = process.env.AI_MODEL_WRITER || process.env.AI_MODEL_CHAT || "Doubao-Seed-1.8";

  const system =
    "你是 NexMind 的对话整理助手。你需要把一段对话上下文整理为一篇结构化 Markdown 笔记。必须输出严格 JSON。";

  const scopeHint = params.partialSelection
    ? "以下为会话中用户**勾选的部分消息**（非全会话），请严格基于这些片段整理，不要臆测未出现的对话内容。\n\n"
    : "";

  const user = `${scopeHint}请将下面对话整理为笔记。\n\n要求：\n1) title：一句话标题（中文为主）\n2) markdown：Markdown 正文，包含小标题与要点（至少包含“核心观点”和“待办/建议”两个部分）\n3) tags：建议标签数组（每个标签以 # 开头，2~8 个字符）\n4) JSON 必须严格符合：{ "title": string, "markdown": string, "tags": string[] }\n5) 禁止在 markdown 里输出「请自行填写」类空表格或下划线占位，信息不足时用简短说明即可\n\n对话如下：\n---\n${params.conversationText.slice(0, 16000)}\n---`;

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = extractJsonFromText(raw) as unknown;
  const obj = asRecord(parsed);
  if (!obj || typeof obj.title !== "string" || typeof obj.markdown !== "string") {
    throw new Error("AI 返回 JSON 结构不符合预期");
  }
  if (!Array.isArray(obj.tags)) throw new Error("AI 返回 tags 不符合预期");

  return {
    title: obj.title,
    markdown: obj.markdown,
    tags: (obj.tags as unknown[]).map((x) => String(x).trim()),
  };
}

