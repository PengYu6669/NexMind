import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { readAuthRequestBody } from "@/lib/auth-request-body";

export async function POST(req: Request) {
  const body = await readAuthRequestBody(req);

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";

  if (!email || !password) {
    return NextResponse.json({ error: "缺少 email 或 password" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "密码长度至少 6 位" }, { status: 400 });
  }

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
