import path from "path";
import { randomBytes } from "crypto";

export function safeUploadBaseName(name: string, fallback = "file"): string {
  const base = path.basename(name).replace(/[^\w.\-\u4e00-\u9fff]+/g, "_");
  return base.slice(0, 120) || fallback;
}

export function makeStorageFileName(fileName: string, fallback = "file"): string {
  const ext = path.extname(fileName) || "";
  const token = randomBytes(8).toString("hex");
  const base = safeUploadBaseName(path.basename(fileName, ext), fallback);
  return `${Date.now()}-${token}-${base}${ext || ""}`;
}
