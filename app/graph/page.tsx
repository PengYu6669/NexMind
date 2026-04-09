import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { KnowledgeGraphView } from "@/components/graph/KnowledgeGraphView";
import { getAuthUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "知识图谱 · NextClaw",
  description: "以图谱俯瞰笔记之间的关联",
};

export default async function GraphPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  return <AppShell center={null} right={<KnowledgeGraphView />} />;
}
