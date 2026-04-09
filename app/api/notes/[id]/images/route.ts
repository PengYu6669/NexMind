import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import path from "path";
import { readFile } from "fs/promises";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/auth";
import { uploadNoteImage } from "@/lib/tos-note-upload";

const MAX_BYTES = 10 * 1024 * 1024;

function safeBaseName(name: string): string {
  const base = path.basename(name).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  return base.slice(0, 120) || "image";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  try {
    const { id: noteId } = await ctx.params;
    if (!noteId?.trim()) return NextResponse.json({ error: "缺少 id" }, { status: 400 });

    const note = await prisma.note.findFirst({
      where: { id: noteId, userId: user.id, archived: false },
      select: { id: true },
    });
    if (!note) return NextResponse.json({ error: "笔记不存在" }, { status: 404 });

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ error: "请使用 multipart 上传图片" }, { status: 400 });
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
      return NextResponse.json({ error: "图片过大（最大 10MB）" }, { status: 400 });
    }

    const mime = file.type || "application/octet-stream";
    if (!mime.startsWith("image/")) {
      return NextResponse.json({ error: "只支持图片类型" }, { status: 400 });
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name) || "";
    const token = randomBytes(8).toString("hex");
    const base = safeBaseName(path.basename(file.name, ext));
    const storageFileName = `${Date.now()}-${token}-${base}${ext || ""}`;

    const out = await uploadNoteImage({
      userId: user.id,
      noteId,
      storageFileName,
      buffer: buf,
      contentType: mime,
    });

    return NextResponse.json({
      url: out.url,
      mimeType: out.mimeType,
      size: out.size,
      storage: out.storage,
      tosKey: out.tosKey,
      tosError: out.tosError,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "图片上传失败" },
      { status: 500 }
    );
  }
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase().replace(".", "");
  switch (e) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "svg":
      return "image/svg+xml";
    default:
      return "application/octet-stream";
  }
}

function getPublicUploadsNeedle(userId: string) {
  // uploadNoteImage 的本地回退 url: /uploads/notes/${userId}/${noteId}/${file}
  return `/uploads/notes/${userId}/`;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id: _noteId } = await ctx.params;

  const url = new URL(req.url);
  const src = url.searchParams.get("src")?.trim() ?? "";
  if (!src) return NextResponse.json({ error: "缺少 src" }, { status: 400 });

  // 校验：只允许处理当前用户/当前笔记的图片（避免 SSRF/open-proxy）
  const uploadsNeedle = getPublicUploadsNeedle(user.id);
  if (src.startsWith("/") && !src.startsWith(uploadsNeedle)) {
    return NextResponse.json({ error: "禁止访问该图片资源" }, { status: 403 });
  }

  // 允许同域存储的 URL（/uploads/...），或 TOS 公网 URL/预签名 URL（包含 notes/${userId}/${noteId}/）
  // 简单 needle 校验：确保 src 内包含 notes/${userId}/
  const tosNeedle = `notes/${user.id}/`;
  if (!src.includes(tosNeedle) && !src.startsWith(uploadsNeedle)) {
    return NextResponse.json({ error: "禁止访问该图片资源" }, { status: 403 });
  }

  try {
    // 本地回退：src 是 /uploads/notes/...，直接读文件，无需跨域
    if (src.startsWith("/")) {
      const safeRel = src.replace(/^\/+/, "");
      if (safeRel.includes("..")) return NextResponse.json({ error: "非法 src" }, { status: 400 });

      // 再次校验：必须落在 /public/uploads/notes/${userId}/ 下
      const uploadsNeedleRel = getPublicUploadsNeedle(user.id).replace(/^\/+/, "");
      if (!safeRel.startsWith(uploadsNeedleRel)) return NextResponse.json({ error: "禁止访问该图片资源" }, { status: 403 });

      const abs = path.join(process.cwd(), "public", safeRel);
      const buf = await readFile(abs);
      const contentType = mimeFromExt(path.extname(abs));
      return new NextResponse(buf, {
        status: 200,
        headers: {
          "content-type": contentType,
          "cache-control": "no-store",
        },
      });
    }

    // TOS/外部 URL：服务器端拉取（不受浏览器 CORS 限制）
    const remote = await fetch(src, { method: "GET" });
    if (!remote.ok) {
      return NextResponse.json({ error: "无法读取图片" }, { status: 502 });
    }

    const arrayBuffer = await remote.arrayBuffer();
    const contentType = remote.headers.get("content-type") || "application/octet-stream";
    return new NextResponse(Buffer.from(arrayBuffer), {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "图片代理失败" },
      { status: 500 }
    );
  }
}

