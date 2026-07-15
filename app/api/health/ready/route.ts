import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { validateRagSchema } from "@/lib/rag";

export async function GET() {
  const checks = { database: "ok", ragSchema: "ok" };
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    checks.database = "error";
    return NextResponse.json(
      { ok: false, status: "not_ready", checks, ...(process.env.NODE_ENV === "development" ? { detail: String(error) } : {}) },
      { status: 503 },
    );
  }
  try {
    await validateRagSchema();
  } catch (error) {
    checks.ragSchema = "error";
    return NextResponse.json(
      { ok: false, status: "not_ready", checks, ...(process.env.NODE_ENV === "development" ? { detail: String(error) } : {}) },
      { status: 503 },
    );
  }
  return NextResponse.json({ ok: true, status: "ready", checks });
}
