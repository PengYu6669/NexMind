import { randomBytes } from "crypto";
import path from "path";
import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { uploadChatFile } from "@/lib/tos-chat-upload";

const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED_PREFIX = [
  "image/",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "text/csv",
];

function safeBaseName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  return base.slice(0, 120) || "file";
}

export async function POST(req: Request) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const ct = req.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return NextResponse.json({ error: "请使用 multipart 上传文件" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "无法解析表单" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "缺少 file" }, { status: 400 });
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "文件过大（最大 5MB）" }, { status: 400 });
  }

  const mime = file.type || "application/octet-stream";
  const ok = ALLOWED_PREFIX.some((p) => mime.startsWith(p));
  if (!ok) {
    return NextResponse.json(
      { error: "不支持的文件类型（支持图片、PDF、文本、Markdown、JSON 等）" },
      { status: 400 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const ext = path.extname(file.name) || "";
  const token = randomBytes(8).toString("hex");
  const base = safeBaseName(path.basename(file.name, ext));
  const storageFileName = `${Date.now()}-${token}-${base}${ext || ""}`;

  const out = await uploadChatFile({
    userId: user.id,
    storageFileName,
    originalName: file.name || storageFileName,
    buffer: buf,
    contentType: mime,
  });

  return NextResponse.json(out);
}
