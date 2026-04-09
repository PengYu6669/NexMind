/** NextClaw：用户是否在要「整理成笔记 / 学习整合」类成稿（用于追加 system 约束） */
export function nextClawAntiFillInBlankExtraPrompt(userContent: string): string | null {
  const t = userContent.trim();
  if (t.length < 2) return null;

  const patterns = [
    /整合\s*笔记/,
    /学习\s*笔记/,
    /整理\s*笔记/,
    /汇总\s*笔记/,
    /合并\s*笔记/,
    /写成\s*笔记/,
    /输出.*笔记/,
    /学习整合/,
    /一周.*学习/,
    /周.*计划.*笔记/,
    /复习\s*笔记/,
    /备考\s*笔记/,
    /帮我.*笔记/,
    /生成.*笔记/,
  ];

  if (!patterns.some((re) => re.test(t))) return null;

  return (
    "【输出约束·整合类请求】用户正在请求整理/整合类笔记或学习总结。你必须直接给出可读、可复制的成稿（可用 Markdown）。\n" +
    "禁止输出「请自行填写」「可自行填写」「填空」「待你补充」类话术，禁止大量空表格、下划线占位（如 ___）、或「自行填写」列。\n" +
    "若上下文信息不足：用简短列表写出「建议用户补充的信息类型」最多三条，并对已有信息写出实质性内容，不要留空模板。"
  );
}
