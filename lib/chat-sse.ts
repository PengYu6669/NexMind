/**
 * 消费 /api/chat/message 返回的 SSE（data: JSON 行），汇总助手最终文本。
 */
export async function consumeChatMessageSse(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuf = "";
  let streamed = "";
  let finalText = "";

  const handleDataPayload = (payload: string) => {
    const raw = payload.trim();
    if (!raw || raw === "[DONE]") return;
    let json: {
      choices?: { delta?: { content?: string } }[];
      error?: { message?: string };
      nexmind_done?: { message?: { content?: string } };
    };
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      return;
    }
    if (json.error?.message) throw new Error(json.error.message);
    if (json.nexmind_done?.message?.content != null) {
      finalText = String(json.nexmind_done.message.content);
      return;
    }
    const c = json.choices?.[0]?.delta?.content;
    if (typeof c === "string" && c.length > 0) streamed += c;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    lineBuf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = lineBuf.indexOf("\n")) >= 0) {
      const line = lineBuf.slice(0, nl);
      lineBuf = lineBuf.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      handleDataPayload(trimmed.slice(5).trimStart());
    }
  }

  if (lineBuf.trim()) {
    const trimmed = lineBuf.trim();
    if (trimmed.startsWith("data:")) handleDataPayload(trimmed.slice(5).trimStart());
  }

  return (finalText || streamed).trim();
}
