function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

function stripHtmlToText(html: string): string {
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(header|footer|nav|aside|form|iframe|button|svg)[^>]*>/gi, "\n")
    .replace(/<(header|footer|nav|aside|form|iframe|button|svg)[^>]*>/gi, "\n")
    .replace(/<(\/)?(article|section|main|p|div|h1|h2|h3|h4|h5|h6|li|ul|ol|br)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return withBreaks
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isNoiseLine(line: string): boolean {
  const x = line.trim().toLowerCase();
  if (!x) return true;
  const hardRules = [
    "copyright",
    "all rights reserved",
    "备案号",
    "关注微信",
    "广告",
    "上一篇",
    "下一篇",
    "推荐阅读",
    "免责声明",
    "隐私政策",
    "使用条款",
    "runoob.com",
  ];
  if (hardRules.some((k) => x.includes(k))) return true;
  // 导航型短词行（例如“Python 教程 / Maven 教程”串）
  if (x.length <= 24 && /(教程|首页|登录|注册|下载|文档|社区|联系我们)/.test(x)) return true;
  return false;
}

function denoiseText(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !isNoiseLine(l));
  // 去重连续重复行
  const out: string[] = [];
  for (const l of lines) {
    if (out[out.length - 1] === l) continue;
    out.push(l);
  }
  return out.join("\n");
}

export async function extractTextFromUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; NexMindBot/0.1; +https://example.com/bot)",
    },
  });

  if (!res.ok) throw new Error(`抓取失败：HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  const html = contentType.includes("text/html") ? await res.text() : await res.text();
  // capture 场景要求高保真保留原文，避免硬截断导致内容缺失
  return denoiseText(stripHtmlToText(html));
}

export function normalizeCaptureInput(input: string): {
  sourceType: "url" | "text";
  sourceUrl?: string;
  text: string;
} {
  const trimmed = input.trim();
  if (looksLikeUrl(trimmed)) {
    return { sourceType: "url", sourceUrl: trimmed, text: trimmed };
  }
  return { sourceType: "text", text: trimmed };
}

