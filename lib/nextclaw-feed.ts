import type { LearningCardType } from "@prisma/client";

export type NextClawFeedUiType = "conflict" | "external_update" | "review";

export type NextClawFeedCardDto = {
  id: string;
  noteId: string;
  noteTitle: string;
  dbType: LearningCardType;
  title: string;
  contentMd: string;
  createdAt: string;
  uiType: NextClawFeedUiType;
  badgeLabel: string;
  summary: string;
  metaLeft: string;
  metaRight: string;
  chips?: string[];
  codeA?: string;
  codeB?: string;
  review?: { reviewItemId: string; progressLabel: string; dueLabel: string; prompt: string };
};

function mdToPlainSummary(md: string, max = 320): string {
  const noFence = md.replace(/```[\s\S]*?```/g, " ");
  return noFence
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*|__/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\n+/g, " ")
    .trim()
    .slice(0, max);
}

function extractCodeFences(md: string): string[] {
  const re = /```(?:[^\n`]*)\n([\s\S]*?)```/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    const t = m[1]?.trim();
    if (t) out.push(t);
  }
  return out;
}

function relativeTimeZh(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} 天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
}

function mapDbTypeToUi(type: LearningCardType): {
  uiType: NextClawFeedUiType;
  badgeLabel: string;
  metaLeft: string;
} {
  switch (type) {
    case "CONFLICT":
      return { uiType: "conflict", badgeLabel: "冲突", metaLeft: "Claw Agent · 冲突卡" };
    case "PITFALL":
      return { uiType: "conflict", badgeLabel: "踩坑", metaLeft: "Claw Agent · 踩坑卡" };
    case "EXTERNAL":
      return { uiType: "external_update", badgeLabel: "外部情报", metaLeft: "External · 变更卡" };
    case "AUDIT":
      return { uiType: "external_update", badgeLabel: "审计", metaLeft: "Auditor · 审计日志" };
    case "FILL_GAP":
      return { uiType: "external_update", badgeLabel: "补位", metaLeft: "Claw Agent · 补位卡" };
    case "RELATED":
      return { uiType: "external_update", badgeLabel: "关联", metaLeft: "回声 · 关联卡" };
    case "REVIEW":
    default:
      return { uiType: "review", badgeLabel: "复习", metaLeft: "Smart Ebbinghaus · 复习卡" };
  }
}

export function learningCardToFeedDto(params: {
  id: string;
  noteId: string;
  noteTitle: string;
  type: LearningCardType;
  title: string;
  contentMd: string;
  createdAt: Date;
  review?: {
    id: string;
    dueDate: Date;
    intervalDays: number;
    lastScore: number | null;
    lastReviewedAt: Date | null;
  } | null;
}): NextClawFeedCardDto {
  const { uiType, badgeLabel, metaLeft } = mapDbTypeToUi(params.type);
  const summary = mdToPlainSummary(params.contentMd);
  const fences = extractCodeFences(params.contentMd);
  let codeA: string | undefined;
  let codeB: string | undefined;
  if (params.type === "CONFLICT" || params.type === "PITFALL") {
    codeA = fences[0];
    codeB = fences[1];
  }

  let review: NextClawFeedCardDto["review"];
  if (params.type === "REVIEW" && params.review) {
    const r = params.review;
    const score = r.lastScore;
    const retention =
      typeof score === "number" && score >= 0 ? Math.round((score / 5) * 100) : null;
    const progressLabel =
      retention != null ? `掌握分 ${score}/5 · 留存约 ${retention}%` : "待首次自评（0–5 分）";
    const dueLabel = `下次复习：${r.dueDate.toLocaleDateString("zh-CN")}（间隔 ${r.intervalDays} 天）`;
    const prompt =
      mdToPlainSummary(params.contentMd, 500) || params.title;
    review = { reviewItemId: r.id, progressLabel, dueLabel, prompt };
  }

  return {
    id: params.id,
    noteId: params.noteId,
    noteTitle: params.noteTitle,
    dbType: params.type,
    title: params.title,
    contentMd: params.contentMd,
    createdAt: params.createdAt.toISOString(),
    uiType,
    badgeLabel,
    summary: summary || params.title,
    metaLeft,
    metaRight: relativeTimeZh(params.createdAt.toISOString()),
    chips: undefined,
    codeA,
    codeB,
    review,
  };
}
