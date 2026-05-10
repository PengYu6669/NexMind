import { NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { getJwtSecret } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("nexmind_auth")?.value;
  if (!token) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub?: string };
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
