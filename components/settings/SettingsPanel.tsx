"use client";

import { useEffect, useState } from "react";

type SettingsPayload = {
  profile: { name: string; email: string; plan: string };
  userSettings: { theme: "dark" | "light" | string; nextclawMemoryEnabled: boolean };
  envSettings: { NEXT_PUBLIC_AI_DEFAULT_MODEL: string; hasSerpApiKey: boolean; maskedSerpApiKey: string };
};

export function SettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState("");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [defaultModel, setDefaultModel] = useState("");
  const [serpapiKey, setSerpapiKey] = useState("");
  const [serpapiMasked, setSerpapiMasked] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/settings", { credentials: "include" });
        if (!r.ok) throw new Error("加载设置失败");
        const data = (await r.json()) as SettingsPayload;
        setName(data.profile.name || "");
        setEmail(data.profile.email || "");
        setPlan(data.profile.plan || "free");
        setTheme(data.userSettings.theme === "light" ? "light" : "dark");
        setMemoryEnabled(Boolean(data.userSettings.nextclawMemoryEnabled));
        setDefaultModel(data.envSettings.NEXT_PUBLIC_AI_DEFAULT_MODEL || "");
        setSerpapiMasked(data.envSettings.maskedSerpApiKey || "");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  async function save() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: { name },
          userSettings: { theme, nextclawMemoryEnabled: memoryEnabled },
          envSettings: { NEXT_PUBLIC_AI_DEFAULT_MODEL: defaultModel, SERPAPI_API_KEY: serpapiKey },
        }),
      });
      const data = (await r.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!r.ok) throw new Error(data?.error || "保存失败");
      setMsg(data?.message || "设置已保存");
      if (serpapiKey.trim()) {
        setSerpapiMasked("已更新");
        setSerpapiKey("");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mx-auto max-w-3xl p-6">
      <div className="rounded-2xl border border-outline-variant/15 bg-surface-container-lowest/30 p-4">
        <h1 className="text-base font-black text-on-surface">设置</h1>
        <p className="mt-1 text-xs text-on-surface-variant">个人信息、模型与搜索密钥配置。</p>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="text-xs text-on-surface-variant">
            昵称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            邮箱（只读）
            <input
              value={email}
              disabled
              className="mt-1 w-full rounded-lg border border-outline-variant/15 bg-surface-container-low/50 px-3 py-2 text-sm text-on-surface-variant"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            默认模型（NEXT_PUBLIC_AI_DEFAULT_MODEL）
            <input
              value={defaultModel}
              onChange={(e) => setDefaultModel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none"
            />
          </label>
          <label className="text-xs text-on-surface-variant">
            主题
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value === "light" ? "light" : "dark")}
              className="mt-1 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none"
            >
              <option value="dark">深色</option>
              <option value="light">浅色</option>
            </select>
          </label>
          <label className="text-xs text-on-surface-variant md:col-span-2">
            搜索 API Key（SERPAPI_API_KEY）
            <input
              value={serpapiKey}
              onChange={(e) => setSerpapiKey(e.target.value)}
              placeholder={serpapiMasked ? `当前：${serpapiMasked}（留空则不改）` : "输入 SerpAPI Key"}
              className="mt-1 w-full rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none"
            />
          </label>
          <label className="md:col-span-2 flex items-center gap-2 text-xs text-on-surface-variant">
            <input type="checkbox" checked={memoryEnabled} onChange={(e) => setMemoryEnabled(e.target.checked)} />
            NextClaw 记忆留存
          </label>
        </div>

        <div className="mt-2 text-xs text-outline">套餐：{plan}</div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            disabled={loading || saving}
            onClick={() => void save()}
            className="rounded-lg bg-primary-container px-4 py-2 text-sm font-bold text-on-primary-container disabled:opacity-60"
          >
            {saving ? "保存中..." : "保存设置"}
          </button>
          {msg ? <span className="text-xs text-primary">{msg}</span> : null}
          {err ? <span className="text-xs text-error">{err}</span> : null}
        </div>
      </div>
    </section>
  );
}

