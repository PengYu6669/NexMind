/**
 * 百度智能云 OCR（通用文字识别高精度版 + PDF 识别）
 * 鉴权支持三选一（按优先级）：
 * 1) BAIDU_OCR_ACCESS_TOKEN（官方文档常见：query access_token）
 * 2) BAIDU_OCR_API_KEY + BAIDU_OCR_SECRET_KEY（自动换取并缓存 access_token）
 * 3) BAIDU_OCR_BEARER_TOKEN（网关/BCE Bearer）
 */

const ACCURATE_BASIC = "https://aip.baidubce.com/rest/2.0/ocr/v1/accurate_basic";
const GENERAL_BASIC = "https://aip.baidubce.com/rest/2.0/ocr/v1/general_basic";
const OAUTH_TOKEN = "https://aip.baidubce.com/oauth/2.0/token";

let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

async function getAuthConfig(): Promise<
  | { mode: "access_token"; token: string }
  | { mode: "bearer"; token: string }
> {
  const accessToken = process.env.BAIDU_OCR_ACCESS_TOKEN?.trim();
  if (accessToken) return { mode: "access_token", token: accessToken };
  const apiKey = process.env.BAIDU_OCR_API_KEY?.trim();
  const secretKey = process.env.BAIDU_OCR_SECRET_KEY?.trim();
  if (apiKey && secretKey) {
    const now = Date.now();
    if (cachedAccessToken && cachedAccessToken.expiresAtMs > now + 60_000) {
      return { mode: "access_token", token: cachedAccessToken.token };
    }
    const tokenUrl = `${OAUTH_TOKEN}?grant_type=client_credentials&client_id=${encodeURIComponent(apiKey)}&client_secret=${encodeURIComponent(secretKey)}`;
    const tokenRes = await fetch(tokenUrl, { method: "POST" });
    const tokenData = (await tokenRes.json().catch(() => ({}))) as Record<string, unknown>;
    if (!tokenRes.ok) {
      const msg =
        (typeof tokenData.error_description === "string" && tokenData.error_description) ||
        (typeof tokenData.error === "string" && tokenData.error) ||
        `HTTP ${tokenRes.status}`;
      throw new Error(`百度 OCR 获取 access_token 失败：${msg}`);
    }
    const token = typeof tokenData.access_token === "string" ? tokenData.access_token.trim() : "";
    const expiresInSec =
      typeof tokenData.expires_in === "number"
        ? tokenData.expires_in
        : Number(tokenData.expires_in ?? 0) || 0;
    if (!token) {
      throw new Error("百度 OCR 获取 access_token 失败：响应中缺少 access_token");
    }
    cachedAccessToken = {
      token,
      expiresAtMs: now + Math.max(300, expiresInSec) * 1000,
    };
    return { mode: "access_token", token };
  }
  const bearer = process.env.BAIDU_OCR_BEARER_TOKEN?.trim();
  if (bearer) return { mode: "bearer", token: bearer };
  throw new Error(
    "缺少百度 OCR 鉴权：请配置 BAIDU_OCR_ACCESS_TOKEN，或 BAIDU_OCR_API_KEY+BAIDU_OCR_SECRET_KEY，或 BAIDU_OCR_BEARER_TOKEN",
  );
}

function extractLines(data: unknown): string {
  const d = data as { words_result?: unknown; result?: unknown };
  const wr = d?.words_result;
  if (Array.isArray(wr)) {
    const lines = wr
      .map((x: unknown) => {
        if (typeof x === "string") return x;
        if (x && typeof x === "object" && "words" in (x as object)) {
          return String((x as { words?: string }).words ?? "");
        }
        return "";
      })
      .filter(Boolean);
    if (lines.length) return lines.join("\n").trim();
  }
  // PDF 可能返回多页结构
  const r = d?.result;
  if (Array.isArray(r)) {
    const parts: string[] = [];
    for (const page of r) {
      const pr = (page as { words_result?: unknown })?.words_result;
      if (Array.isArray(pr)) {
        for (const x of pr) {
          if (x && typeof x === "object" && "words" in (x as object)) {
            parts.push(String((x as { words?: string }).words ?? ""));
          }
        }
      }
    }
    if (parts.length) return parts.join("\n").trim();
  }
  return "";
}

async function postForm(url: string, params: Record<string, string>): Promise<unknown> {
  const auth = await getAuthConfig();
  const body = new URLSearchParams(params);
  const finalUrl =
    auth.mode === "access_token"
      ? `${url}${url.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(auth.token)}`
      : url;
  const res = await fetch(finalUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...(auth.mode === "bearer" ? { Authorization: `Bearer ${auth.token}` } : {}),
    },
    body,
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const brief = JSON.stringify(data).slice(0, 500);
  if (!res.ok) {
    const msg =
      (typeof data.error_msg === "string" && data.error_msg) ||
      (typeof data.error_description === "string" && data.error_description) ||
      `HTTP ${res.status}`;
    throw new Error(`[baidu-ocr] endpoint=${url} auth=${auth.mode} status=${res.status} msg=${msg} body=${brief}`);
  }
  const code = data.error_code;
  if (code !== undefined && code !== 0 && code !== "0") {
    const msg = typeof data.error_msg === "string" ? data.error_msg : String(code);
    throw new Error(`[baidu-ocr] endpoint=${url} auth=${auth.mode} code=${String(code)} msg=${msg} body=${brief}`);
  }
  return data;
}

/** 图片 base64（无 data: 前缀）→ 纯文本 */
export async function baiduOcrAccurateBasic(imageBase64: string): Promise<string> {
  const data = await postForm(ACCURATE_BASIC, {
    image: imageBase64,
    detect_direction: "false",
  });
  return extractLines(data);
}

/** PDF 整文件 base64；pdf_file_num 为页码（从 1 起），多数场景先识别第 1 页 */
export async function baiduOcrPdf(pdfBase64: string, pdfFileNum = "1"): Promise<string> {
  // 兼容性策略：
  // 1) 优先用 accurate_basic + pdf_file（你给的参数集来自该通道）
  // 2) 若该能力未开通/不支持，再退回 general_basic + pdf_file
  // 3) 都失败时抛出包含双接口细节的错误，便于直接从 parseError 定位
  try {
    const data = await postForm(ACCURATE_BASIC, {
      pdf_file: pdfBase64,
      pdf_file_num: pdfFileNum,
      detect_direction: "false",
      probability: "false",
    });
    return extractLines(data);
  } catch (e1) {
    try {
      const data2 = await postForm(GENERAL_BASIC, {
        pdf_file: pdfBase64,
        pdf_file_num: pdfFileNum,
        detect_direction: "false",
        probability: "false",
      });
      return extractLines(data2);
    } catch (e2) {
      const m1 = e1 instanceof Error ? e1.message : String(e1);
      const m2 = e2 instanceof Error ? e2.message : String(e2);
      throw new Error(`[baidu-ocr] PDF识别失败; accurate_basic=${m1}; general_basic=${m2}`);
    }
  }
}
