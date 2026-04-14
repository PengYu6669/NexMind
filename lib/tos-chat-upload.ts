import { randomBytes } from "crypto";
import path from "path";
import { mkdir, readFile, writeFile } from "fs/promises";
import { Readable } from "stream";
import TosClient from "@volcengine/tos-sdk";

function isTosFullyConfigured(): boolean {
  return Boolean(
    process.env.VOLC_TOS_REGION?.trim() &&
      process.env.VOLC_TOS_ACCESS_KEY?.trim() &&
      process.env.VOLC_TOS_SECRET_KEY?.trim() &&
      process.env.VOLC_TOS_ENDPOINT?.trim() &&
      process.env.VOLC_TOS_BUCKET?.trim()
  );
}

let client: TosClient | null = null;

function getTosClient(): TosClient {
  if (client) return client;
  const region = process.env.VOLC_TOS_REGION!.trim();
  const accessKeyId = process.env.VOLC_TOS_ACCESS_KEY!.trim();
  const accessKeySecret = process.env.VOLC_TOS_SECRET_KEY!.trim();
  const endpoint = process.env.VOLC_TOS_ENDPOINT!.trim();
  const secure = process.env.VOLC_TOS_SECURE !== "false";

  client = new TosClient({
    region,
    accessKeyId,
    accessKeySecret,
    endpoint,
    secure,
  });
  return client;
}

function objectKey(userId: string, storageFileName: string): string {
  const prefix = (process.env.VOLC_TOS_PREFIX ?? "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  const keyBody = `chat/${userId}/${storageFileName}`;
  return prefix ? `${prefix}/${keyBody}` : keyBody;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  return await new Promise((resolve, reject) => {
    stream.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

/** 预签名 GET，默认 7 天；若桶绑定 CDN/自定义域名可设 VOLC_TOS_PUBLIC_BASE_URL 得到稳定链接 */
function publicUrlForKey(key: string): string {
  const base = process.env.VOLC_TOS_PUBLIC_BASE_URL?.trim();
  if (base) {
    const escaped = key.split("/").map(encodeURIComponent).join("/");
    return `${base.replace(/\/$/, "")}/${escaped}`;
  }
  const expires = Math.min(
    Math.max(60, Number(process.env.VOLC_TOS_PRESIGN_EXPIRES_SEC ?? 604800) || 604800),
    604800 * 4
  );
  const bucket = process.env.VOLC_TOS_BUCKET!.trim();
  return getTosClient().getPreSignedUrl({
    bucket,
    key,
    method: "GET",
    expires,
  });
}

export async function uploadChatFile(params: {
  userId: string;
  /** 落库对象名（已做唯一化） */
  storageFileName: string;
  /** 展示给用户的原始文件名 */
  originalName: string;
  buffer: Buffer;
  contentType: string;
}): Promise<{ url: string; name: string; mimeType: string; size: number; storageKey: string }> {
  const mime = params.contentType || "application/octet-stream";
  const size = params.buffer.length;
  const displayName = params.originalName.trim() || params.storageFileName;

  if (isTosFullyConfigured()) {
    const key = objectKey(params.userId, params.storageFileName);
    const bucket = process.env.VOLC_TOS_BUCKET!.trim();
    await getTosClient().putObject({
      bucket,
      key,
      body: params.buffer,
      contentType: mime,
    });
    const url = publicUrlForKey(key);
    return {
      url,
      name: displayName,
      mimeType: mime,
      size,
      storageKey: key,
    };
  }

  const dir = path.join(process.cwd(), "public", "uploads", "chat", params.userId);
  await mkdir(dir, { recursive: true });
  const fsPath = path.join(dir, params.storageFileName);
  await writeFile(fsPath, params.buffer);

  return {
    url: `/uploads/chat/${params.userId}/${params.storageFileName}`,
    name: displayName,
    mimeType: mime,
    size,
    storageKey: `local:${params.userId}/${params.storageFileName}`,
  };
}

/** 按上传时返回的 storageKey 读取原始字节（供解析/OCR） */
export async function downloadChatFileBuffer(params: { storageKey: string }): Promise<Buffer> {
  const key = params.storageKey.trim();
  if (!key) throw new Error("缺少 storageKey");

  if (key.startsWith("local:")) {
    const rest = key.slice("local:".length);
    const fsPath = path.join(process.cwd(), "public", "uploads", "chat", rest);
    return readFile(fsPath);
  }

  if (!isTosFullyConfigured()) {
    throw new Error("TOS 未配置，无法按 storageKey 拉取对象");
  }
  const bucket = process.env.VOLC_TOS_BUCKET!.trim();
  const out = await getTosClient().getObject({ bucket, key });
  const body = (out as { data?: unknown }).data ?? (out as { body?: unknown }).body;
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as any)?.arrayBuffer === "function") {
    const ab = await (body as Blob).arrayBuffer();
    return Buffer.from(ab);
  }
  if (body && typeof (body as Readable).pipe === "function") {
    return streamToBuffer(body as Readable);
  }
  throw new Error("无法读取 TOS 对象内容");
}

export { isTosFullyConfigured };
