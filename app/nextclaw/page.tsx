import type { Metadata } from "next";
import { NextClawPageClient } from "@/components/nextclaw/NextClawPageClient";

export const metadata: Metadata = {
  title: "NextClaw · AI 智能助手",
  description: "基于知识库的一键开场与对话，低学习成本",
};

export default function NextClawPage() {
  return <NextClawPageClient />;
}
