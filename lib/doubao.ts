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
        const delta = deltaObj?.content;
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
                const delta = json?.choices?.[0]?.delta?.content;
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
        const meta = await onComplete(full || "");
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ nexmind_done: meta })}\n\n`)
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
  const model = process.env.AI_MODEL_SUMMARY || "Doubao-Seed-2.0-lite";

  const system =
    "你是 NexMind 的内容提取与结构化助手。你需要把用户提供的网页正文/文本片段提炼成结构化结果。必须输出严格 JSON，字段与类型要满足约束。";

  const user = `请对以下内容提取并整理为“结构化笔记（Markdown）”。必须输出严格 JSON，字段与类型要满足约束。\n\n要求：\n- title：一句话标题（中文为主）\n- keyPoints：恰好 3 条要点（每条不超过 100 字），要能概括全文核心\n- tags：建议标签数组（每个标签以 # 开头，长度 2~8）\n- cleanedContent：Markdown 正文（结构化排版），要求至少包含以下 4 个小标题：\n  1) ## 核心观点（使用 keyPoints 作为要点，并可补充 1~2 句解释）\n  2) ## 要点（给出比 keyPoints 更细的要点，建议 5~10 条；每条尽量 1~3 句）\n  3) ## 补充（背景/术语/关键注意事项/容易误解的点；3~6 条）\n  4) ## 待办/建议（行动建议或可执行清单；3~6 条）\n  另外：cleanedContent 总长度建议 2000~6000 字符（比之前更详细，但不要写成原文复读）\n\n输出示例：\n{\n  "title": "...",\n  "keyPoints": ["...","...","..."],\n  "tags": [\"#AI\",\"#技术\"],\n  "cleanedContent": \"## 核心观点\\n- ...\\n\\n## 要点\\n- ...\\n\\n## 补充\\n- ...\\n\\n## 待办/建议\\n- ...\"\n}\n\n---\n内容如下：\n${inputText.slice(0, 20000)}\n---`;

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const parsed = extractJsonFromText(raw) as unknown;
  const obj = asRecord(parsed);
  if (
    !obj ||
    typeof obj.title !== "string" ||
    !Array.isArray(obj.keyPoints) ||
    obj.keyPoints.length !== 3 ||
    !Array.isArray(obj.tags)
  ) {
    throw new Error("AI 返回 JSON 结构不符合预期");
  }

  return {
    title: obj.title,
    keyPoints: (obj.keyPoints as unknown[]).map((x) => String(x)),
    tags: (obj.tags as unknown[]).map((x) => String(x).trim()),
    cleanedContent: String(obj.cleanedContent ?? ""),
  };
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

