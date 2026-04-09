import type { Metadata } from "next";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspacePlaceholder } from "@/components/layout/WorkspacePlaceholder";

export const metadata: Metadata = {
  title: "帮助 · NexMind",
  description: "使用帮助与支持",
};

export default function HelpPage() {
  return (
    <AppShell
      center={<WorkspacePlaceholder title="帮助中心" description="文档与常见问题将放在此处。" />}
    />
  );
}
