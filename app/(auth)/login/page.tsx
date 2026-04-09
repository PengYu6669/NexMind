import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata: Metadata = {
  title: "登录 · NexMind",
  description: "NexMind System Console — 登录",
};

export default function LoginPage() {
  return <AuthCard mode="login" />;
}
