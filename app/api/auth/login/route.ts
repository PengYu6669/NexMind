import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "@/lib/prisma";

function getJwtSecret(): string {
  // 开发环境可用默认值；上线请务必配置真实密钥。
  return process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || "dev-insecure-secret";
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    email?: string;
    password?: string;
    remember?: boolean | string;
  };

  const email = body.email?.trim().toLowerCase();
  const password = body.password;

  if (!email || !password) {
    return NextResponse.json({ error: "缺少 email 或 password" }, { status: 400 });
  }

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

  const secret = getJwtSecret();
  const token = jwt.sign({ sub: user.id, email: user.email }, secret, { expiresIn: "7d" });

  // remember=true 时延长 cookie 生命周期（前端 checkbox 提供 on/true）
  const remember =
    body.remember === true || body.remember === "true" || body.remember === "on" || body.remember === "1";
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

