import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export function LandingPage() {
  return (
    <div className="min-w-0 font-body text-on-surface antialiased selection:bg-primary/30">
      <div className="fixed inset-0 z-[-1] overflow-hidden bg-surface-container-lowest">
        <div className="absolute inset-0 tech-grid" />
        <div className="glow-orb animate-breathe absolute left-[-10%] top-[-10%] h-[50%] w-[50%] rounded-full bg-primary" />
        <div
          className="glow-orb animate-breathe absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-primary-container"
          style={{ animationDelay: "-4s" }}
        />
        {/* 放在背景层：避免叠在正文上；保留扫描氛围 */}
        <div
          className="animate-scan-line pointer-events-none absolute left-0 z-0 h-1 w-full bg-gradient-to-r from-transparent via-primary/10 to-transparent"
          style={{ boxShadow: "0 0 10px rgba(192, 193, 255, 0.08)" }}
        />
      </div>

      <MarketingNav />

      <main className="relative z-20 flex min-h-screen flex-col items-center justify-center px-4 pt-20 sm:px-6">
        {/* 首屏：水平居中；标题略缩小 + 单行不换行，避免「AI 第二大脑」折行 */}
        <div className="flex w-full min-w-0 max-w-5xl flex-col items-center space-y-10 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-outline-variant/20 bg-surface-container-high/50 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            系统 v1.0.4-beta
          </div>

          <div className="w-full min-w-0 space-y-5">
            <div className="w-full text-center">
              <h1 className="inline-block max-w-full font-headline text-[clamp(0.78rem,3.1vw+0.35rem,2.6rem)] font-extrabold leading-tight tracking-tight text-on-surface whitespace-nowrap">
                NexMind · AI 第二大脑
              </h1>
            </div>
            <p className="mx-auto max-w-2xl font-body text-base font-light leading-relaxed tracking-wide text-on-surface-variant sm:text-lg md:text-xl">
              个人智能笔记助手与知识库。通过深度神经网络构建您的数字心智，实现海量信息的秒级检索与逻辑重组。
            </p>
          </div>

          <div className="flex flex-col items-center justify-center gap-4 pt-2 sm:flex-row">
            <Link
              href="/dashboard"
              className="group relative inline-flex items-center gap-3 rounded-xl bg-gradient-to-br from-primary to-primary-container px-8 py-3.5 text-base font-bold text-on-primary transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(192,193,255,0.3)] sm:px-10 sm:py-4 sm:text-lg"
            >
              进入系统
              <MaterialIcon
                name="arrow_forward"
                className="transition-transform group-hover:translate-x-1"
              />
            </Link>
          </div>
        </div>

        <section id="features" className="mx-auto mt-32 grid w-full max-w-6xl grid-cols-1 gap-6 md:grid-cols-12">
          <div className="glass-panel flex min-h-[320px] flex-col justify-between rounded-xl border border-outline-variant/10 bg-surface-container-low/40 p-8 md:col-span-7">
            <div className="space-y-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                <MaterialIcon name="psychology" className="text-primary" />
              </div>
              <h3 className="font-headline text-2xl font-bold text-on-surface">神经关联检索</h3>
              <p className="leading-relaxed text-on-surface-variant">
                不再局限于关键词搜索。NexMind 理解你笔记背后的语义逻辑，自动建立跨文档的知识索引。
              </p>
            </div>
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap pt-8 opacity-50">
              <span className="rounded border border-outline-variant/20 bg-surface-container-high px-2 py-1 font-mono text-[10px]">
                VECTOR_SEARCH_STABLE
              </span>
              <span className="rounded border border-outline-variant/20 bg-surface-container-high px-2 py-1 font-mono text-[10px]">
                SEMANTIC_MAP_SYNC
              </span>
              <span className="rounded border border-outline-variant/20 bg-surface-container-high px-2 py-1 font-mono text-[10px]">
                RAG_ENABLED
              </span>
            </div>
          </div>

          <div className="glass-panel flex min-h-[320px] flex-col rounded-xl border border-outline-variant/10 bg-surface-container-highest/30 p-8 md:col-span-5">
            <div className="relative flex flex-grow items-center justify-center overflow-hidden group">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary via-transparent to-transparent opacity-20" />
              <div className="z-10 text-center">
                <MaterialIcon
                  name="deployed_code"
                  className="mb-4 block text-6xl text-primary-fixed-dim"
                  filled
                />
                <div className="mx-auto h-1 w-24 overflow-hidden rounded-full bg-primary/30">
                  <div className="h-full w-1/2 animate-pulse bg-primary" />
                </div>
              </div>
            </div>
            <div className="mt-auto space-y-2">
              <h3 className="font-headline text-xl font-bold text-on-surface">原子化知识管理</h3>
              <p className="text-sm text-on-surface-variant">
                将长难句拆解为可组合的原子笔记，实现知识的无限生长与复用。
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/10 bg-surface-container/50 p-6 md:col-span-4">
            <MaterialIcon name="auto_awesome" className="mb-3 text-primary" />
            <h4 className="mb-2 font-bold">AI 协同写作</h4>
            <p className="text-sm text-on-surface-variant">
              实时生成摘要、扩写灵感、纠正逻辑谬误，让写作流程如丝般顺滑。
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container/50 p-6 md:col-span-4">
            <MaterialIcon name="security" className="mb-3 text-primary" />
            <h4 className="mb-2 font-bold">端到端私有化</h4>
            <p className="text-sm text-on-surface-variant">
              本地优先架构，数据属于用户。支持私有化模型部署，保障企业级数据隐私。
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container/50 p-6 md:col-span-4">
            <MaterialIcon name="sync" className="mb-3 text-primary" />
            <h4 className="mb-2 font-bold">多端同步</h4>
            <p className="text-sm text-on-surface-variant">
              跨设备无缝衔接，无论是桌面端的研究还是移动端的灵感捕捉，瞬间同步到位。
            </p>
          </div>
        </section>

        <footer className="mb-12 mt-32 w-full max-w-6xl border-t border-outline-variant/10 py-8">
          <div className="flex flex-col items-center gap-2 text-center font-mono text-[10px] uppercase tracking-widest text-on-surface-variant/60">
            <a
              href="https://github.com/PengYu6669"
              target="_blank"
              rel="noreferrer"
              className="transition-colors hover:text-primary"
            >
              © PengYu6669
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
