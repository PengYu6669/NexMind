import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth";
import { LearnPageClient } from "@/components/learn/LearnPageClient";

export const metadata: Metadata = {
  title: "学习中心 · NexMind",
  description: "以卡片为主导的复习与自测",
};

export default async function LearnPage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return <LearnPageClient />;
}

