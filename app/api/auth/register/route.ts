import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const body = (await req.json()) as {
    email?: string;
    password?: string;
    name?: string;
    remember?: boolean | string;
  };

  const email = body.email?.trim().toLowerCase();
  const password = body.password;
  const name = body.name?.trim();

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
  const user = await prisma.user.create({
    data: {
      email,
      name: name || undefined,
      passwordHash,
      userSettings: { create: {} },
    },
    select: { id: true, email: true },
  });

  // 注册阶段只创建账号；登录时再发放 cookie，符合“注册后再登录”的预期流程。
  return NextResponse.json({ ok: true });
}

