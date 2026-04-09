import path from "path";
import { mkdir, writeFile } from "fs/promises";
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

  // 强制固定 endpoint + secure，规避 tos-sdk 内部 endpoint/secure 组合导致的签名不匹配
  const endpoint = "tos-cn-beijing.volces.com";

  client = new TosClient({
    region,
    accessKeyId,
    accessKeySecret,
    endpoint,
    secure: true,
  });
  return client;
}

function objectKey(params: { userId: string; noteId: string; storageFileName: string }): string {
  // 强制固定前缀，规避 key 拼接导致的路径不一致
  const prefix = "nexmind/notes/images";
  const keyBody = `notes/${params.userId}/${params.noteId}/${params.storageFileName}`;
  return `${prefix}/${keyBody}`;
}

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

export async function uploadNoteImage(params: {
  userId: string;
  noteId: string;
  storageFileName: string;
  buffer: Buffer;
  contentType: string;
}): Promise<{
  url: string;
  mimeType: string;
  size: number;
  storage: "tos" | "local";
  tosKey?: string;
  tosError?: string;
}> {
  const mime = params.contentType || "application/octet-stream";
  const size = params.buffer.length;

  const dir = path.join(process.cwd(), "public", "uploads", "notes", params.userId, params.noteId);
  await mkdir(dir, { recursive: true });
  const fsPath = path.join(dir, params.storageFileName);
  const localOut = {
    url: `/uploads/notes/${params.userId}/${params.noteId}/${params.storageFileName}`,
    mimeType: mime,
    size,
  } as const;

  if (isTosFullyConfigured()) {
    try {
      const key = objectKey({
        userId: params.userId,
        noteId: params.noteId,
        storageFileName: params.storageFileName,
      });
      const bucket = process.env.VOLC_TOS_BUCKET!.trim();
      await getTosClient().putObject({
        bucket,
        key,
        body: params.buffer,
        contentType: mime,
      });
      return { url: publicUrlForKey(key), mimeType: mime, size, storage: "tos", tosKey: key };
    } catch (err) {
      // TOS 配置存在但上传失败：回退本地，避免粘贴图片直接中断
      // 尽量复用 key 以便你在控制台里定位对象路径
      let tosKey: string | undefined;
      try {
        tosKey = objectKey({
          userId: params.userId,
          noteId: params.noteId,
          storageFileName: params.storageFileName,
        });
      } catch {
        tosKey = undefined;
      }
      console.error("[uploadNoteImage] TOS putObject failed:", {
        error: err,
        bucket: process.env.VOLC_TOS_BUCKET,
        tosKey,
      });
      const tosError = err instanceof Error ? err.message : String(err);
      await writeFile(fsPath, params.buffer);
      return { ...localOut, storage: "local", tosKey, tosError };
    }
  }

  await writeFile(fsPath, params.buffer);
  return { ...localOut, storage: "local" };
}

