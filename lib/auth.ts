import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma";

export type AuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  plan: string;
};

function getJwtSecret(): string {
  return process.env.AUTH_JWT_SECRET || process.env.JWT_SECRET || "dev-insecure-secret";
}

export async function getAuthUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get("nexmind_auth")?.value;
  if (!token) return null;

  try {
    const secret = getJwtSecret();
    const payload = jwt.verify(token, secret) as { sub?: string };
    const userId = payload.sub;
    if (!userId) return null;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, plan: true },
    });
    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      plan: user.plan,
    };
  } catch {
    return null;
  }
}

