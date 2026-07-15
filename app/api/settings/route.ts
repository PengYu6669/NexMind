import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { firstValidationMessage, settingsInputSchema } from "@/lib/api-inputs";

export async function GET() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const settings = await prisma.userSettings.findUnique({
      where: { userId: user.id },
      select: { theme: true, nextclawMemoryEnabled: true },
    });
  return NextResponse.json({
    ok: true,
    profile: { name: user.name ?? "", email: user.email ?? "", plan: user.plan },
    userSettings: {
      theme: settings?.theme ?? "dark",
      nextclawMemoryEnabled: settings?.nextclawMemoryEnabled ?? true,
    },
    systemCapabilities: {
      defaultModel: process.env.NEXT_PUBLIC_AI_DEFAULT_MODEL ?? "",
      webSearchConfigured: Boolean(process.env.SERPAPI_API_KEY?.trim()),
    },
  });
}

export async function PATCH(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const parsed = settingsInputSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });
  const body = parsed.data;

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

  return NextResponse.json({ ok: true, message: "设置已保存" });
}

