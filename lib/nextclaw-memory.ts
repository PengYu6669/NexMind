import { prisma } from "@/lib/prisma";
import { callDashscopeChatCompletion, extractJsonFromText } from "@/lib/doubao";

export const NEXTCLAW_MEMORY_SCOPE = "nextclaw";

/** 无设置行时视为开启，与 Prisma 默认值一致 */
export async function isNextClawMemoryInjectEnabled(userId: string): Promise<boolean> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { nextclawMemoryEnabled: true },
  });
  if (!row) return true;
  return row.nextclawMemoryEnabled;
}

const MAX_INJECT_CHARS = 3600;
const EXTRACT_KEYS = [
  "current_topic",
  "stated_goal",
  "preferences",
  "next_action",
] as const;

type ExtractKey = (typeof EXTRACT_KEYS)[number];

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function textFromValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  const o = asRecord(value);
  if (o && typeof o.text === "string") return o.text.trim();
  return "";
}

/** 拼入 system：UserMemory + 最近一条 LearningSnapshot，有总长度上限 */
export async function buildNextClawMemoryBlock(userId: string): Promise<string> {
  const [memories, snapshot] = await Promise.all([
    prisma.userMemory.findMany({
      where: { userId, scope: NEXTCLAW_MEMORY_SCOPE },
      orderBy: [{ importance: "desc" }, { updatedAt: "desc" }],
      take: 20,
      select: { key: true, value: true, importance: true },
    }),
    prisma.learningSnapshot.findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { summary: true, createdAt: true, recommendations: true },
    }),
  ]);

  const lines: string[] = [];

  for (const m of memories) {
    const t = textFromValue(m.value);
    if (!t) continue;
    const label =
      {
        current_topic: "当前主题",
        stated_goal: "近期目标",
        preferences: "偏好",
        next_action: "建议的下一步",
      }[m.key] ?? m.key;
    lines.push(`- ${label}：${t.slice(0, 800)}`);
  }

  if (snapshot?.summary?.trim()) {
    const when = snapshot.createdAt.toISOString().slice(0, 10);
    lines.push(`- 最近学习快照（${when}）：${snapshot.summary.trim().slice(0, 1200)}`);
  }

  let block = lines.join("\n");
  if (block.length > MAX_INJECT_CHARS) {
    block = block.slice(0, MAX_INJECT_CHARS) + "…";
  }
  return block;
}

export async function upsertNextClawMemoryEntries(
  userId: string,
  entries: Partial<Record<ExtractKey, string>>
): Promise<void> {
  const importanceMap: Record<ExtractKey, number> = {
    current_topic: 3,
    stated_goal: 3,
    preferences: 2,
    next_action: 1,
  };

  for (const key of EXTRACT_KEYS) {
    const raw = entries[key];
    if (typeof raw !== "string") continue;
    const text = raw.trim();
    if (!text || text.length > 600) continue;

    await prisma.userMemory.upsert({
      where: {
        userId_scope_key: {
          userId,
          scope: NEXTCLAW_MEMORY_SCOPE,
          key,
        },
      },
      create: {
        userId,
        scope: NEXTCLAW_MEMORY_SCOPE,
        key,
        value: { text },
        importance: importanceMap[key],
        lastSeenAt: new Date(),
      },
      update: {
        value: { text },
        importance: importanceMap[key],
        lastSeenAt: new Date(),
      },
    });
  }
}

/** 对话结束后异步调用：从最后一轮抽取可复用记忆 */
export async function extractNextClawMemoriesFromTurn(
  userId: string,
  userMessage: string,
  assistantMessage: string
): Promise<void> {
  const u = userMessage.trim();
  const a = assistantMessage.trim();
  if (u.length + a.length < 80) return;

  const model =
    process.env.AI_MODEL_MEMORY_EXTRACT ||
    process.env.AI_MODEL_CHAT ||
    "Doubao-Seed-2.0-lite";

  const prompt = `从下面「用户」与「助手」的最后一轮对话中，提取可跨会话复用的简短事实（偏好、长期目标、当前学习主题、助手明确建议的下一步等）。
只输出一个 JSON 对象，不要 markdown、不要解释。字段均为可选字符串，没有则省略或设为 null：
- current_topic：用户当前在学什么/写什么
- stated_goal：用户表达的近期目标
- preferences：对回答风格或形式的偏好
- next_action：对话中明确的下一步行动（若有）
若没有任何可提取项，输出 {}

用户：
${u.slice(0, 8000)}

助手：
${a.slice(0, 8000)}`;

  const raw = await callDashscopeChatCompletion({
    model,
    messages: [
      {
        role: "system",
        content:
          "你是信息抽取器，只输出合法 JSON 对象，键仅限 current_topic、stated_goal、preferences、next_action。",
      },
      { role: "user", content: prompt },
    ],
  });

  let parsed: unknown;
  try {
    parsed = extractJsonFromText(raw);
  } catch {
    return;
  }

  const obj = asRecord(parsed);
  if (!obj) return;

  const entries: Partial<Record<ExtractKey, string>> = {};
  for (const key of EXTRACT_KEYS) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) {
      entries[key] = v.trim();
    }
  }

  if (Object.keys(entries).length === 0) return;
  await upsertNextClawMemoryEntries(userId, entries);
}
