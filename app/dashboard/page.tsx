import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";

export const metadata: Metadata = {
  title: "工作台 · NexMind",
  description: "NexMind 主工作台",
};

export default function DashboardPage() {
  // 首页（工作台）不再展示中间笔记栏，避免布局冗余
  return <AppShell center={null} />;
}
