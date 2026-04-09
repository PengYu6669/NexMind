import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { smokeTestEmbedding } from "@/lib/rag";

/**
 * GET /api/rag/embedding-test
 * 登录后访问，验证 AI_MODEL_EMBEDDING + AI_API_BASE_URL 是否可用（不写库）
 */
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const result = await smokeTestEmbedding();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
