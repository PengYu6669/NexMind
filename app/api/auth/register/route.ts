import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { readAuthRequestBody } from "@/lib/auth-request-body";
import { firstValidationMessage, registerInputSchema } from "@/lib/api-inputs";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const rate = consumeRateLimit(`auth:register:${clientAddress(req)}`, { limit: 20, windowMs: 15 * 60_000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "请求过于频繁，请稍后再试", code: "RATE_LIMITED" }, {
      status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
    });
  }
  const body = await readAuthRequestBody(req);
  const parsed = registerInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });
  const { email, password, name = "" } = parsed.data;

  const existed = await prisma.user.findUnique({ where: { email } });
  if (existed) {
    return NextResponse.json({ error: "该邮箱已注册" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: {
      email,
      name: name || undefined,
      passwordHash,
      userSettings: { create: {} },
    },
    select: { id: true },
  });

  return NextResponse.json({ ok: true });
}
