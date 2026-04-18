import { conflictAuditInputSchema, type ConflictAuditInput } from "@/lib/nextclaw-skills/types";

function toSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]/g)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8)
    .slice(0, 40);
}

export type ConflictAuditResult = {
  conflicts: string[];
  fillGaps: string[];
  evidence: string[];
};

export function runConflictAuditSkill(raw: ConflictAuditInput): ConflictAuditResult {
  const input = conflictAuditInputSchema.parse(raw);
  const noteSentences = toSentences(input.noteText);
  const fetchedSentences = toSentences(input.fetchedMarkdown);

  const noteSet = new Set(noteSentences.map((s) => s.toLowerCase()));
  const conflicts: string[] = [];
  const fillGaps: string[] = [];
  const evidence: string[] = [];

  for (const s of fetchedSentences) {
    const key = s.toLowerCase();
    if (!noteSet.has(key) && fillGaps.length < 6) {
      fillGaps.push(`可补充：${s.slice(0, 140)}`);
    }
    if ((s.includes("不推荐") || s.includes("已弃用") || s.includes("deprecated")) && conflicts.length < 4) {
      conflicts.push(`潜在冲突：${s.slice(0, 140)}`);
    }
  }

  if (input.relatedNotes.length > 0) {
    for (const n of input.relatedNotes.slice(0, 3)) {
      evidence.push(`相关笔记《${n.title}》可用于交叉核验`);
    }
  }

  if (fillGaps.length === 0 && conflicts.length === 0) {
    evidence.push("未发现明显冲突或高价值补位点");
  }

  return { conflicts, fillGaps, evidence };
}
