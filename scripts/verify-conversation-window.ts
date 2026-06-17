import "dotenv/config";

import { buildConversationWindow, estimateTokenCount, type ChatMessage } from "@/lib/nextclaw-conversation-window";
import { CONVERSATION_MAX_TOKENS, CONVERSATION_KEEP_RECENT } from "@/lib/nextclaw-agent-config";

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(`FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function makeMessages(count: number): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    msgs.push({
      role: i % 2 === 0 ? "user" : "assistant",
      content:
        i % 2 === 0
          ? `用户第 ${i + 1} 条消息：这是一段包含中英文混合的长文本，用于测试 token 估算的准确性。Python, JavaScript, TypeScript, React, LangGraph 等都是常见关键词。`.repeat(
              3,
            )
          : `助手第 ${i + 1} 条回复：好的，我来回答您的问题。关于多 Agent 编排，LangGraph 支持显式图结构，而 AutoGen 更偏向对话协商。每种框架都有不同的适用场景。`.repeat(
              3,
            ),
    });
  }
  return msgs;
}

async function main() {
  console.log("=== 会话窗口验证 ===\n");

  // 1) Token 估算
  console.log("1) Token 估算");
  assert(estimateTokenCount("") === 0, "空文本 → 0 token");
  assert(estimateTokenCount("你好世界") >= 2, "纯中文 → ≥2 token");
  assert(estimateTokenCount("Hello World") >= 2, "纯英文 → ≥2 token");
  const mixed = "你好 World 测试 Test";
  const mixedTokens = estimateTokenCount(mixed);
  assert(mixedTokens >= 3, `中英混合 → ≥3 token (got ${mixedTokens})`);
  console.log();

  // 2) 短对话（不超预算）
  console.log("2) 短对话 — 不超预算，全量返回");
  {
    const short = makeMessages(4);
    const result = buildConversationWindow(short);
    assert(result.windowMessages.length === 4, "4 条消息全量返回");
    assert(!result.truncated, "未截断");
    assert(result.summary === "", "无摘要");
    console.log(`   estimatedTokens=${result.estimatedTokens}`);
  }
  console.log();

  // 3) 长对话（超预算）
  console.log("3) 长对话 — 超预算，压缩早期消息");
  {
    const longMsgs = makeMessages(40);
    // 用较小预算强制触发截断
    const result = buildConversationWindow(longMsgs, { maxTokens: 500, keepRecent: 8 });
    assert(result.truncated, "已截断");
    assert(result.summary.length > 0, "生成摘要");
    assert(
      result.windowMessages.length <= CONVERSATION_KEEP_RECENT,
      `窗口消息 ≤ ${CONVERSATION_KEEP_RECENT} 条 (got ${result.windowMessages.length})`,
    );
    console.log(`   summary length=${result.summary.length} chars`);
    console.log(`   window=${result.windowMessages.length} messages`);
    console.log(`   estimatedTokens=${result.estimatedTokens}`);
    // 摘要(~530 tok) + 8 条最近消息(~745 tok) ≈ 1275，远超预算说明窗口本身内容就很长
    assert(result.estimatedTokens > 500, "估算 token > 预算（长消息场景合理）");
    assert(result.windowMessages.length === 8, "仍然保留 8 条消息");
  }
  console.log();

  // 4) 空消息
  console.log("4) 空消息");
  {
    const result = buildConversationWindow([]);
    assert(result.windowMessages.length === 0, "空消息返回空窗口");
    assert(!result.truncated, "未截断");
    assert(result.summary === "", "无摘要");
  }
  console.log();

  // 5) 配置值检查
  console.log("5) Tunables 检查");
  assert(CONVERSATION_MAX_TOKENS > 0, `CONVERSATION_MAX_TOKENS=${CONVERSATION_MAX_TOKENS} > 0`);
  assert(CONVERSATION_KEEP_RECENT > 0, `CONVERSATION_KEEP_RECENT=${CONVERSATION_KEEP_RECENT} > 0`);
  console.log();

  // 6) 摘要内容验证
  console.log("6) 摘要内容验证");
  {
    const msgs = makeMessages(30);
    const result = buildConversationWindow(msgs, { maxTokens: 400, keepRecent: 6 });
    assert(result.summary.includes("早期对话概览"), "摘要包含概览行");
    assert(result.summary.includes("用户发言"), "摘要包含用户发言统计");
    assert(result.summary.includes("助手回复"), "摘要包含助手回复统计");
    console.log(`   summary preview: "${result.summary.slice(0, 120)}..."`);
  }
  console.log();

  // 7) 极端场景：keepRecent 条消息本身就超预算
  console.log("7) 极端场景 — 最近消息本身超预算");
  {
    const hugeMsgs: ChatMessage[] = Array.from({ length: CONVERSATION_KEEP_RECENT }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: "这是一段非常非常长的消息，包含大量的文本内容。".repeat(50),
    }));
    const result = buildConversationWindow(hugeMsgs, { maxTokens: 100, keepRecent: CONVERSATION_KEEP_RECENT });
    assert(result.truncated, "极端场景触发截断");
    assert(result.windowMessages.length < CONVERSATION_KEEP_RECENT, "窗口进一步缩小");
    console.log(`   window reduced to ${result.windowMessages.length} messages`);
  }

  console.log("\n✅ 会话窗口验证全部通过");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
