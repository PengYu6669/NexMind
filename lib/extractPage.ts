function looksLikeUrl(input: string): boolean {
  return /^https?:\/\//i.test(input.trim());
}

function stripHtmlToText(html: string): string {
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<\/(header|footer|nav|aside|form|iframe|button|svg)[^>]*>/gi, " ")
    .replace(/<(header|footer|nav|aside|form|iframe|button|svg)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return cleaned.replace(/\s+/g, " ").trim();
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
  // 给“快速捕获”的结构化提取留更多上下文，但仍做硬截断避免成本失控
  return stripHtmlToText(html).slice(0, 24000);
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

