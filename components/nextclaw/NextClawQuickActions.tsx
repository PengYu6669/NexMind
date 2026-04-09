"use client";

import { MaterialIcon } from "@/components/ui/MaterialIcon";

const PRESETS: { label: string; hint: string; prompt: string; icon: string }[] = [
  {
    label: "今日复习",
    hint: "从知识库抽要点 + 自测题",
    prompt:
      "根据我的知识库内容，帮我列出今天适合复习的 3 个要点，每个要点给一道简短的自测问答题（附参考答案要点）。",
    icon: "school",
  },
  {
    label: "拓展学习",
    hint: "推荐可深入的方向",
    prompt:
      "结合我笔记里最近关注的主题，推荐 3 个可以深入学习的方向；每个方向用一两句话说明为什么值得学、可以从哪类笔记继续延伸。",
    icon: "explore",
  },
  {
    label: "一周计划",
    hint: "可执行的小步骤",
    prompt:
      "根据我的知识库，帮我列接下来一周的学习计划：每天一项任务，要具体可执行（例如「复习某篇笔记中的某概念」），并说明理由。",
    icon: "calendar_month",
  },
  {
    label: "薄弱自查",
    hint: "追问可能薄弱环节",
    prompt:
      "根据我的笔记内容，推测我可能还没掌握或需要加强的环节，用 5 个追问帮我自查；每个问题后附一句「若答不上来可以补哪类笔记」。",
    icon: "quiz",
  },
];

export function NextClawQuickActions({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
      <div className="shrink-0 border-b border-outline-variant/10 px-4 py-4">
        <h2 className="font-headline text-sm font-bold text-on-surface">一键开场</h2>
        <p className="mt-1 text-xs leading-relaxed text-on-surface-variant">
          点选后填入右侧输入框，可直接发送，也可改几个字再发——无需记指令。
        </p>
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain px-3 py-3 [scrollbar-gutter:stable]">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onPick(p.prompt)}
            className="flex w-full gap-3 rounded-xl border border-outline-variant/15 bg-surface-container-low/90 px-3 py-3 text-left transition-colors hover:border-primary/30 hover:bg-surface-container"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-container/15 text-primary">
              <MaterialIcon name={p.icon} className="text-xl" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold text-on-surface">{p.label}</span>
              <span className="mt-0.5 block text-[11px] text-on-surface-variant">{p.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
