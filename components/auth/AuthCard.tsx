"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type AuthMode = "login" | "register";

export function AuthCard({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showPassword2, setShowPassword2] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const form = new FormData(e.currentTarget);
      const email = String(form.get("email") || "");
      const password = String(form.get("password") || "");

      if (mode === "register") {
        const password2 = String(form.get("password2") || "");
        if (!password2 || password2 !== password) {
          throw new Error("两次输入的密码不一致");
        }
      }

      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const payload: Record<string, unknown> = {
        email,
        password,
      };
      if (mode === "register") {
        payload.name = String(form.get("name") || "");
      }
      if (mode === "login") {
        payload.remember = form.get("remember") ? true : false;
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!res.ok) {
        throw new Error(data?.error || "请求失败");
      }

      router.push(mode === "login" ? "/dashboard" : "/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录/注册失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative z-10 w-full max-w-md px-6">
      <div className="mb-10 flex flex-col items-center">
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-container shadow-lg">
          <MaterialIcon name="terminal" className="text-3xl text-on-primary" filled />
        </div>
        <h1 className="font-headline text-3xl font-extrabold tracking-tighter text-slate-100">NexMind</h1>
        <p className="mt-1 text-sm font-medium uppercase tracking-widest text-on-surface-variant opacity-60">
          System Console Access
        </p>
      </div>

      <div className="glass-panel-auth rounded-xl border border-outline-variant/10 p-8 shadow-[0_20px_40px_rgba(6,14,32,0.4)]">
        <div className="mb-8 flex rounded-lg bg-surface-container-lowest p-1">
          <Link
            href="/login"
            className={`flex-1 rounded-md py-2 text-center text-sm font-semibold transition-all duration-200 ${
              mode === "login"
                ? "bg-primary-container text-on-primary-container shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            登录
          </Link>
          <Link
            href="/register"
            className={`flex-1 rounded-md py-2 text-center text-sm font-semibold transition-all duration-200 ${
              mode === "register"
                ? "bg-primary-container text-on-primary-container shadow-sm"
                : "text-on-surface-variant hover:text-on-surface"
            }`}
          >
            注册
          </Link>
        </div>

        <form className="space-y-6" onSubmit={onSubmit}>
          {mode === "register" && (
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-semibold text-on-surface-variant" htmlFor="name">
                显示名称 / DISPLAY NAME
              </label>
              <div className="group relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <MaterialIcon
                    name="person"
                    className="text-lg text-outline transition-colors group-focus-within:text-primary"
                  />
                </div>
                <input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="研究员"
                  className="block w-full rounded-lg border-0 bg-surface-container-lowest py-3 pl-11 pr-4 text-on-surface placeholder:text-outline/50 transition-all duration-200 focus:bg-surface-container-highest focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="ml-1 block text-xs font-semibold text-on-surface-variant" htmlFor="email">
              电子邮件 / EMAIL
            </label>
            <div className="group relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                <MaterialIcon
                  name="alternate_email"
                  className="text-lg text-outline transition-colors group-focus-within:text-primary"
                />
              </div>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                  placeholder="admin@nexmind.ai"
                className="block w-full rounded-lg border-0 bg-surface-container-lowest py-3 pl-11 pr-4 text-on-surface placeholder:text-outline/50 transition-all duration-200 focus:bg-surface-container-highest focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <label className="block text-xs font-semibold text-on-surface-variant" htmlFor="password">
                访问密钥 / PASSWORD
              </label>
              {mode === "login" && (
                <Link href="/forgot-password" className="text-xs font-medium text-primary transition-colors hover:text-primary-fixed-dim">
                  忘记密钥?
                </Link>
              )}
            </div>
            <div className="group relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                <MaterialIcon
                  name="lock"
                  className="text-lg text-outline transition-colors group-focus-within:text-primary"
                />
              </div>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                placeholder="••••••••••••"
                className="block w-full rounded-lg border-0 bg-surface-container-lowest py-3 pl-11 pr-12 text-on-surface placeholder:text-outline/50 transition-all duration-200 focus:bg-surface-container-highest focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
              <button
                type="button"
                className="absolute inset-y-0 right-0 flex items-center pr-3 text-outline transition-colors hover:text-on-surface"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
              >
                <MaterialIcon name={showPassword ? "visibility" : "visibility_off"} className="text-lg" />
              </button>
            </div>
          </div>

          {mode === "register" && (
            <div className="space-y-1.5">
              <label className="ml-1 block text-xs font-semibold text-on-surface-variant" htmlFor="password2">
                确认密钥 / CONFIRM
              </label>
              <div className="group relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5">
                  <MaterialIcon
                    name="lock_reset"
                    className="text-lg text-outline transition-colors group-focus-within:text-primary"
                  />
                </div>
                <input
                  id="password2"
                  name="password2"
                  type={showPassword2 ? "text" : "password"}
                  required
                  autoComplete="new-password"
                  placeholder="••••••••••••"
                  className="block w-full rounded-lg border-0 bg-surface-container-lowest py-3 pl-11 pr-12 text-on-surface placeholder:text-outline/50 transition-all duration-200 focus:bg-surface-container-highest focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-outline transition-colors hover:text-on-surface"
                  onClick={() => setShowPassword2((v) => !v)}
                  aria-label={showPassword2 ? "隐藏密码" : "显示密码"}
                >
                  <MaterialIcon name={showPassword2 ? "visibility" : "visibility_off"} className="text-lg" />
                </button>
              </div>
            </div>
          )}

          {mode === "login" && (
            <div className="flex items-center space-x-2 px-1">
              <input
                id="remember"
                name="remember"
                type="checkbox"
                className="h-4 w-4 rounded border-outline-variant bg-surface-container-lowest text-primary focus:ring-primary focus:ring-offset-surface"
              />
              <label htmlFor="remember" className="text-xs text-on-surface-variant">
                保持此会话登录
              </label>
            </div>
          )}

          {error ? (
            <p className="text-sm font-medium text-on-error-container" aria-live="polite">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            className="glow-button group flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary-container to-inverse-primary py-4 font-headline text-sm font-bold tracking-widest text-on-primary-container transition-all duration-200 active:scale-[0.98]"
            disabled={loading}
          >
            {loading
              ? "处理中..."
              : mode === "login"
                ? "初始化连接 / INITIALIZE"
                : "创建账户 / CREATE ACCOUNT"}
            <MaterialIcon
              name="arrow_forward"
              className="text-lg transition-transform group-hover:translate-x-1"
            />
          </button>
        </form>

        {/* 按你当前需求：移除登录/注册页的 SSO 入口 */}
      </div>

      <footer className="mt-10 flex flex-col items-center gap-4 text-center">
        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link
            href="/terms"
            className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/40 transition-colors hover:text-primary"
          >
            服务条款
          </Link>
          <span className="h-1 w-1 rounded-full bg-outline-variant/30" />
          <Link
            href="/privacy"
            className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/40 transition-colors hover:text-primary"
          >
            隐私协议
          </Link>
          <span className="h-1 w-1 rounded-full bg-outline-variant/30" />
          <Link
            href="/"
            className="text-[10px] font-bold uppercase tracking-[0.2em] text-on-surface-variant/40 transition-colors hover:text-primary"
          >
            系统状态
          </Link>
        </div>
        <p className="font-mono text-[10px] tracking-tighter text-on-surface-variant/30">
          © PengYu6669 · NexMind v1.0.4-beta
        </p>
      </footer>

      <div className="pointer-events-none fixed bottom-0 left-1/2 h-[100px] w-[600px] -translate-x-1/2 rounded-full bg-primary/20 opacity-50 blur-[100px]" />
    </main>
  );
}
