import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export const metadata: Metadata = {
  title: "设置 · NexMind",
  description: "个人信息与密钥配置",
};

export default function SettingsPage() {
  return <AppShell center={null} right={<SettingsPanel />} />;
}
