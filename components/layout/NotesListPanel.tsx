import Link from "next/link";
import { Suspense } from "react";
import { NotesKnowledgeSearch } from "@/components/knowledge/NotesKnowledgeSearch";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type NoteCard = {
  id: string;
  title: string;
  excerpt: string;
  tags: string[];
  timeLabel: string;
  featured?: boolean;
};

const demoNotes: NoteCard[] = [
  {
    id: "1",
    title: "2024 年度 Q3 市场战略研究报告",
    excerpt:
      "AI 摘要：本报告重点分析了东南亚新兴市场的竞争格局。核心结论建议将研发重心转向移动端优先体验。",
    tags: ["#ProjectA", "#重要"],
    timeLabel: "12 分钟前",
    featured: true,
  },
  {
    id: "2",
    title: "产品迭代会议记录 - 8月24日",
    excerpt:
      "会议主要讨论了用户反馈的加载速度缓慢问题。工程师团队提议使用 React Server Components 进行重构。",
    tags: ["#Work"],
    timeLabel: "2 小时前",
  },
  {
    id: "3",
    title: "周末滑雪旅行计划清单",
    excerpt: "AI 摘要：清单包括滑雪板租赁、防寒服准备以及度假村预订确认。建议周四检查气象报告。",
    tags: ["#Personal"],
    timeLabel: "昨天 18:30",
  },
  {
    id: "4",
    title: "《非对称性风险》深度摘要",
    excerpt: "讨论了 Skin in the Game 的核心逻辑。AI 已将关键章节提炼为可检索要点。",
    tags: ["#Reading", "#Books"],
    timeLabel: "3 天前",
  },
];

export function NotesListPanel({
  className = "",
  notes,
}: {
  className?: string;
  notes?: NoteCard[];
}) {
  const displayNotes = notes && notes.length ? notes : demoNotes;
  return (
    <section className={`flex min-h-0 flex-col bg-surface ${className}`.trim()}>
      <div className="shrink-0 border-b border-outline-variant/10 px-6 py-5">
        <div className="mb-1 flex items-center justify-between gap-3">
          <h2 className="font-headline text-xl font-extrabold tracking-tight text-on-surface">笔记</h2>
          <button
            type="button"
            className="rounded-lg bg-surface-container-low p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high"
            aria-label="筛选"
          >
            <MaterialIcon name="tune" className="text-lg" />
          </button>
        </div>
        <p className="text-xs leading-relaxed text-on-surface-variant">
          语义搜索已整合在下方；结果可跳转到对应笔记。
        </p>
      </div>

      <Suspense
        fallback={
          <div className="shrink-0 border-b border-outline-variant/10 px-4 py-3 text-xs text-on-surface-variant">
            加载搜索…
          </div>
        }
      >
        <NotesKnowledgeSearch />
      </Suspense>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 no-scrollbar">
        {displayNotes.map((note, idx) => {
          const isFeatured = note.featured ?? idx === 0;
          return isFeatured ? (
            <Link key={note.id} href={`/notes/${note.id}`} className="block">
              <article
                className="group relative overflow-hidden rounded-xl border border-transparent bg-surface-container-low p-5 transition-colors duration-300 hover:bg-surface-container-high"
              >
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl transition-colors group-hover:bg-primary/10" />
              <div className="relative z-10">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap gap-2">
                    {note.tags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                  <span className="text-xs font-medium text-slate-500">{note.timeLabel}</span>
                </div>
                <h3 className="mb-2 font-headline text-lg font-bold transition-colors group-hover:text-primary">
                  {note.title}
                </h3>
              </div>
              </article>
            </Link>
          ) : (
            <Link key={note.id} href={`/notes/${note.id}`} className="block">
              <article className="glass-card group flex flex-col justify-between rounded-xl border border-transparent p-4 transition-all duration-300 hover:bg-surface-container-highest">
                <div>
                  <div className="mb-2 flex flex-wrap gap-2">
                  {note.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-full bg-surface-container-high px-2.5 py-0.5 text-xs font-bold text-on-surface-variant"
                    >
                      {t}
                    </span>
                  ))}
                  </div>
                  <h3 className="mb-2 font-headline text-base font-bold transition-colors group-hover:text-primary">
                    {note.title}
                  </h3>
                </div>
                <div className="flex items-center justify-between border-t border-outline-variant/10 pt-3">
                  <span className="text-xs text-slate-500">{note.timeLabel}</span>
                  <MaterialIcon name="arrow_forward" className="text-sm text-primary opacity-0 transition-opacity group-hover:opacity-100" />
                </div>
              </article>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
