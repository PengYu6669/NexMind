import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { readAuthRequestBody } from "@/lib/auth-request-body";

export async function POST(req: Request) {
  const body = await readAuthRequestBody(req);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

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

  const token = jwt.sign({ sub: user.id, email: user.email }, getJwtSecret(), { expiresIn: "7d" });

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
