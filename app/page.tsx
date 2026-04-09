import type { Metadata } from "next";
import { LandingPage } from "@/components/marketing/LandingPage";

export const metadata: Metadata = {
  title: "NexMind · AI 第二大脑",
  description: "个人智能笔记助手与知识库，秒级检索与逻辑重组。",
};

export default function Home() {
  return <LandingPage />;
}
