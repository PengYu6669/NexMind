import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

const ENV_PATH = resolve(process.cwd(), ".env");

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i <= 0) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

async function loadEnvFile() {
  try {
    const text = await fs.readFile(ENV_PATH, "utf8");
    return { text, map: parseEnv(text) };
  } catch {
    return { text: "", map: {} as Record<string, string> };
  }
}

function upsertEnvText(source: string, updates: Record<string, string>) {
  const lines = source ? source.split(/\r?\n/) : [];
  const next = [...lines];
  const seen = new Set<string>();
  for (let idx = 0; idx < next.length; idx++) {
    const m = next[idx].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m) continue;
    const key = m[1];
    if (!(key in updates)) continue;
    next[idx] = `${key}=${updates[key]}`;
    seen.add(key);
  }
  for (const [k, v] of Object.entries(updates)) {
    if (!seen.has(k)) next.push(`${k}=${v}`);
  }
  return `${next.join("\n").replace(/\n+$/g, "")}\n`;
}

function maskSecret(v: string): string {
  if (!v) return "";
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 4)}****${v.slice(-4)}`;
}

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const [settings, envFile] = await Promise.all([
    prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: { theme: true, nextclawMemoryEnabled: true },
    }),
    loadEnvFile(),
  ]);

  const serp = envFile.map.SERPAPI_API_KEY ?? "";
  return NextResponse.json({
    ok: true,
    profile: { name: user.name ?? "", email: user.email ?? "", plan: user.plan },
    userSettings: {
      theme: settings?.theme ?? "dark",
      nextclawMemoryEnabled: settings?.nextclawMemoryEnabled ?? true,
    },
    envSettings: {
      NEXT_PUBLIC_AI_DEFAULT_MODEL: envFile.map.NEXT_PUBLIC_AI_DEFAULT_MODEL ?? "",
      hasSerpApiKey: Boolean(serp),
      maskedSerpApiKey: serp ? maskSecret(serp) : "",
    },
  });
}

export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    profile?: { name?: unknown };
    userSettings?: { theme?: unknown; nextclawMemoryEnabled?: unknown };
    envSettings?: { NEXT_PUBLIC_AI_DEFAULT_MODEL?: unknown; SERPAPI_API_KEY?: unknown };
  };

  if (typeof body.profile?.name === "string") {
    await prisma.user.update({
      where: { id: user.id },
      data: { name: body.profile.name.trim().slice(0, 80) },
    });
  }

  const updateSettings: { theme?: string; nextclawMemoryEnabled?: boolean } = {};
  if (body.userSettings?.theme === "dark" || body.userSettings?.theme === "light") {
    updateSettings.theme = body.userSettings.theme;
  }
  if (typeof body.userSettings?.nextclawMemoryEnabled === "boolean") {
    updateSettings.nextclawMemoryEnabled = body.userSettings.nextclawMemoryEnabled;
  }
  if (Object.keys(updateSettings).length) {
    await prisma.userSettings.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...updateSettings },
      update: updateSettings,
    });
  }

  const envUpdates: Record<string, string> = {};
  if (typeof body.envSettings?.NEXT_PUBLIC_AI_DEFAULT_MODEL === "string") {
    envUpdates.NEXT_PUBLIC_AI_DEFAULT_MODEL = body.envSettings.NEXT_PUBLIC_AI_DEFAULT_MODEL.trim();
  }
  if (typeof body.envSettings?.SERPAPI_API_KEY === "string") {
    const v = body.envSettings.SERPAPI_API_KEY.trim();
    if (v) envUpdates.SERPAPI_API_KEY = v;
  }
  if (Object.keys(envUpdates).length) {
    const envFile = await loadEnvFile();
    await fs.writeFile(ENV_PATH, upsertEnvText(envFile.text, envUpdates), "utf8");
  }

  return NextResponse.json({ ok: true, message: "设置已保存（环境变量变更需重启后生效）" });
}

