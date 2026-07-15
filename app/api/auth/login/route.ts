import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readAuthRequestBody } from "@/lib/auth-request-body";
import { firstValidationMessage, loginInputSchema } from "@/lib/api-inputs";
import { clientAddress, consumeRateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const rate = consumeRateLimit(`auth:login:${clientAddress(req)}`, { limit: 30, windowMs: 15 * 60_000 });
  if (!rate.allowed) {
    return NextResponse.json({ error: "登录尝试过多，请稍后再试", code: "RATE_LIMITED" }, {
      status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) },
    });
  }
  const body = await readAuthRequestBody(req);
  const parsed = loginInputSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: firstValidationMessage(parsed.error) }, { status: 400 });
  const { email, password, remember: rememberValue } = parsed.data;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, passwordHash: true },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  const token = jwt.sign({ sub: user.id, email: user.email }, getJwtSecret(), { expiresIn: "7d" });

  const remember = rememberValue === true || rememberValue === "true" || rememberValue === "on" || rememberValue === "1";
  const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7;

  const res = NextResponse.json({ ok: true });
  res.cookies.set("nexmind_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  });

  return res;
}
