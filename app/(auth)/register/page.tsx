import type { Metadata } from "next";
import { AuthCard } from "@/components/auth/AuthCard";

export const metadata: Metadata = {
  title: "注册 · NexMind",
  description: "NexMind System Console — 注册",
};

export default function RegisterPage() {
  return <AuthCard mode="register" />;
}
