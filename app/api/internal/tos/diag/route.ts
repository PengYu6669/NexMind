import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import TosClient from "@volcengine/tos-sdk";
import { getAuthUser } from "@/lib/auth";

function normalizeEndpoint(raw: string): string {
  return raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const region = process.env.VOLC_TOS_REGION?.trim() || "";
  const accessKeyId = process.env.VOLC_TOS_ACCESS_KEY?.trim() || "";
  const accessKeySecret = process.env.VOLC_TOS_SECRET_KEY?.trim() || "";
  const endpointRaw = process.env.VOLC_TOS_ENDPOINT?.trim() || "";
  const endpoint = normalizeEndpoint(endpointRaw);
  const bucket = process.env.VOLC_TOS_BUCKET?.trim() || "";
  const secure = process.env.VOLC_TOS_SECURE !== "false";
  const prefix = (process.env.VOLC_TOS_PREFIX ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");

  if (!region || !accessKeyId || !accessKeySecret || !endpoint || !bucket) {
    return NextResponse.json(
      {
        ok: false,
        error: "缺少 TOS 配置",
        config: {
          hasRegion: Boolean(region),
          hasAccessKeyId: Boolean(accessKeyId),
          hasAccessKeySecret: Boolean(accessKeySecret),
          hasEndpoint: Boolean(endpoint),
          hasBucket: Boolean(bucket),
        },
      },
      { status: 400 }
    );
  }

  const keyPrefix = prefix ? `${prefix}/diag` : "diag";
  const key = `${keyPrefix}/${user.id}/${Date.now()}-${randomBytes(6).toString("hex")}.txt`;
  const body = Buffer.from(`tos-diag ${new Date().toISOString()}\n`, "utf8");

  const client = new TosClient({
    region,
    accessKeyId,
    accessKeySecret,
    endpoint,
    secure,
  });

  let putOk = false;
  let headOk = false;
  let deleteOk = false;
  let putError: string | null = null;
  let headError: string | null = null;
  let deleteError: string | null = null;

  try {
    await client.putObject({
      bucket,
      key,
      body,
      contentType: "text/plain; charset=utf-8",
    });
    putOk = true;
  } catch (e) {
    putError = e instanceof Error ? e.message : String(e);
  }

  if (putOk) {
    try {
      await client.headObject({ bucket, key });
      headOk = true;
    } catch (e) {
      headError = e instanceof Error ? e.message : String(e);
    }

    try {
      await client.deleteObject({ bucket, key });
      deleteOk = true;
    } catch (e) {
      deleteError = e instanceof Error ? e.message : String(e);
    }
  }

  const ok = putOk && headOk;
  return NextResponse.json({
    ok,
    config: {
      region,
      endpoint,
      secure,
      bucket,
      prefix,
    },
    probe: {
      key,
      putOk,
      headOk,
      deleteOk,
      putError,
      headError,
      deleteError,
    },
  });
}

