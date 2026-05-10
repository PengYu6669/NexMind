import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const featureCards = [
  {
    icon: "travel_explore",
    title: "语义检索",
    body: "不用记关键词，直接用问题找回笔记、资料和关联线索。",
    tone: "bg-[#dceeb1]",
  },
  {
    icon: "account_tree",
    title: "知识图谱",
    body: "自动把碎片内容连成结构，帮助你看见主题之间的关系。",
    tone: "bg-[#c8e6cd]",
  },
  {
    icon: "auto_awesome",
    title: "AI 协作",
    body: "摘要、追问、补全和复习卡片，都围绕你的知识库生成。",
    tone: "bg-[#efd4d4]",
  },
];

const workflowSteps = ["捕获资料", "沉淀笔记", "构建关联", "复习迁移"];

export function LandingPage() {
  return (
    <div className="min-w-0 bg-white font-body text-black antialiased selection:bg-[#dceeb1]">
      <MarketingNav />

      <main className="overflow-hidden">
        <section className="relative flex min-h-[92vh] items-center px-5 pb-16 pt-28 sm:px-8 lg:px-10">
          <div className="mx-auto grid w-full max-w-7xl items-center gap-12 lg:grid-cols-[0.95fr_1.05fr]">
            <div className="min-w-0">
              <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-black bg-white px-4 py-2 text-sm font-semibold">
                <span className="h-2.5 w-2.5 rounded-full bg-[#1ea64a]" />
                Personal Knowledge OS
              </div>

              <h1 className="max-w-4xl font-headline text-[clamp(3.3rem,8.6vw,7.7rem)] font-[340] leading-[0.96] tracking-normal text-black">
                NexMind
              </h1>
              <p className="mt-6 max-w-2xl text-[clamp(1.3rem,2.3vw,2rem)] font-[340] leading-snug text-black">
                把笔记、搜索、AI 学习和知识图谱放进一个清爽的个人第二大脑。
              </p>
              <p className="mt-6 max-w-xl text-base leading-8 text-neutral-600 sm:text-lg">
                从捕获灵感到复习迁移，NexMind 帮你把零散内容整理成可检索、可追踪、可复用的知识系统。
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/register"
                  className="inline-flex items-center justify-center rounded-full bg-black px-6 py-3 text-base font-semibold text-white transition-transform active:scale-[0.98]"
                >
                  开始使用
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center justify-center rounded-full border border-black bg-white px-6 py-3 text-base font-semibold text-black transition-colors hover:bg-[#f7f7f5]"
                >
                  进入工作台
                </Link>
              </div>
            </div>

            <div className="relative min-h-[520px] lg:min-h-[620px]">
              <div className="absolute right-0 top-0 h-[58%] w-[72%] rounded-[32px] bg-[#c5b0f4]" />
              <div className="absolute bottom-10 left-0 h-[42%] w-[54%] rounded-[32px] bg-[#dceeb1]" />
              <div className="absolute left-[8%] top-[9%] w-[88%] rounded-[28px] border border-black bg-white p-3 shadow-[12px_12px_0_#000] sm:p-4">
                <div className="rounded-[22px] border border-black bg-[#f7f7f5]">
                  <div className="flex items-center justify-between border-b border-black px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-full bg-[#ff3d8b]" />
                      <span className="h-3 w-3 rounded-full bg-[#f3c9b6]" />
                      <span className="h-3 w-3 rounded-full bg-[#1ea64a]" />
                    </div>
                    <span className="font-mono text-xs text-neutral-500">workspace.today</span>
                  </div>

                  <div className="grid min-h-[420px] gap-0 lg:grid-cols-[0.74fr_1.26fr]">
                    <aside className="border-b border-black bg-white p-4 lg:border-b-0 lg:border-r">
                      <div className="mb-4 flex items-center gap-2 text-sm font-bold">
                        <MaterialIcon name="notes" className="text-lg" />
                        知识库
                      </div>
                      {["产品想法", "学习计划", "论文摘要"].map((item, index) => (
                        <div
                          key={item}
                          className={`mb-2 rounded-lg border border-black px-3 py-2 text-sm ${
                            index === 0 ? "bg-[#dceeb1]" : "bg-[#f7f7f5]"
                          }`}
                        >
                          {item}
                        </div>
                      ))}
                    </aside>

                    <div className="p-4 sm:p-5">
                      <div className="mb-4 rounded-2xl border border-black bg-white p-4">
                        <div className="mb-3 flex items-center justify-between">
                          <h2 className="text-lg font-black">AI 学习任务</h2>
                          <span className="rounded-full bg-black px-3 py-1 text-xs font-bold text-white">运行中</span>
                        </div>
                        <div className="space-y-2">
                          {workflowSteps.map((step, index) => (
                            <div key={step} className="flex items-center gap-3">
                              <span className="flex h-7 w-7 items-center justify-center rounded-full border border-black bg-[#f4ecd6] text-xs font-black">
                                {index + 1}
                              </span>
                              <div className="h-2 flex-1 rounded-full bg-neutral-200">
                                <div
                                  className="h-full rounded-full bg-black"
                                  style={{ width: `${88 - index * 16}%` }}
                                />
                              </div>
                              <span className="w-20 text-right text-xs font-semibold">{step}</span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-2xl border border-black bg-[#c8e6cd] p-4">
                          <div className="mb-8 text-sm font-bold">关联节点</div>
                          <div className="text-4xl font-black">128</div>
                        </div>
                        <div className="rounded-2xl border border-black bg-[#efd4d4] p-4">
                          <div className="mb-8 text-sm font-bold">待复习</div>
                          <div className="text-4xl font-black">24</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="features" className="border-y border-black bg-[#f7f7f5] px-5 py-16 sm:px-8 lg:px-10">
          <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-3">
            {featureCards.map((feature) => (
              <article key={feature.title} className={`${feature.tone} rounded-[24px] border border-black p-8`}>
                <MaterialIcon name={feature.icon} className="mb-8 text-4xl" />
                <h3 className="text-2xl font-black">{feature.title}</h3>
                <p className="mt-4 text-lg leading-8 text-neutral-800">{feature.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="px-5 py-20 sm:px-8 lg:px-10">
          <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.9fr_1.1fr]">
            <div>
              <p className="font-mono text-sm uppercase tracking-[0.18em] text-neutral-500">Workflow</p>
              <h2 className="mt-4 max-w-2xl text-4xl font-[420] leading-tight sm:text-6xl">
                从输入到掌握，每一步都能追踪。
              </h2>
            </div>
            <div className="grid gap-3">
              {workflowSteps.map((step, index) => (
                <div key={step} className="grid grid-cols-[auto_1fr] gap-4 rounded-[24px] border border-black bg-white p-5">
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black font-mono text-sm text-white">
                    0{index + 1}
                  </span>
                  <div>
                    <h3 className="text-xl font-black">{step}</h3>
                    <p className="mt-1 leading-7 text-neutral-600">
                      {index === 0 && "快速保存网页、文件、想法与对话，不让信息散落在不同工具里。"}
                      {index === 1 && "让 AI 帮你整理摘要、关键概念和可行动的下一步。"}
                      {index === 2 && "通过语义关系把旧知识和新材料连起来，形成自己的上下文。"}
                      {index === 3 && "生成学习卡片与复习队列，让知识真正回到日常使用中。"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-20 sm:px-8 lg:px-10">
          <div className="mx-auto max-w-7xl rounded-[32px] border border-black bg-black p-8 text-white sm:p-12">
            <div className="grid items-end gap-8 lg:grid-cols-[1fr_auto]">
              <div>
                <p className="font-mono text-sm uppercase tracking-[0.18em] text-white/60">NexMind</p>
                <h2 className="mt-4 max-w-3xl text-4xl font-[420] leading-tight sm:text-6xl">
                  让你的知识库变成每天可用的工作流。
                </h2>
              </div>
              <Link
                href="/register"
                className="inline-flex items-center justify-center rounded-full bg-white px-6 py-3 text-base font-semibold text-black"
              >
                创建账号
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-black px-5 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm text-neutral-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© PengYu6669</span>
          <div className="flex gap-5">
            <Link href="/privacy" className="hover:text-black">
              隐私
            </Link>
            <Link href="/terms" className="hover:text-black">
              条款
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
