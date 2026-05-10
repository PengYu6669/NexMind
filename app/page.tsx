import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "NexMind - AI 第二大脑",
  description: "个人智能笔记助手与知识库，支持语义检索、知识图谱和 AI 学习工作流。",
};

export default function Home() {
  return <LandingPage />;
}
