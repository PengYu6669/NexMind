import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function getJwtSecret(): string {
  // 与登录接口保持一致
  return process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || "dev-insecure-secret";
}

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("nexmind_auth")?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret) as { sub?: string };
    const userId = payload.sub;
    if (!userId) {
      return NextResponse.json({ user: null }, { status: 401 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, plan: true },
    });

    return NextResponse.json({ user: user ?? null });
  } catch {
    return NextResponse.json({ user: null }, { status: 401 });
  }
}

