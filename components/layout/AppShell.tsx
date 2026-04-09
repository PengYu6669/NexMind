import type { ReactNode } from "react";
import { AiChatPanel } from "@/components/layout/AiChatPanel";
import { AppSidebar } from "@/components/layout/AppSidebar";
import { AppTopBar } from "@/components/layout/AppTopBar";
import { NotesListPanel } from "@/components/layout/NotesListPanel";

type AppShellProps = {
  /** 中间栏；默认显示笔记列表面板 */
  center?: ReactNode;
  /** 右侧主区；默认工作台 AI 对话 */
  right?: ReactNode;
};

export function AppShell({ center, right }: AppShellProps) {
  return (
    <div className="h-[100dvh] min-h-0 overflow-hidden bg-surface">
      <AppSidebar />
      <div className="flex h-full min-h-0 flex-col pl-64">
        <AppTopBar />
        <div className="flex min-h-0 flex-1 overflow-hidden pt-16 pb-8">
          {center === null ? null : (
            <div className="flex min-h-0 w-full max-w-md shrink-0 flex-col self-stretch overflow-hidden border-r border-outline-variant/10 lg:max-w-[380px]">
              {center ?? <NotesListPanel className="min-h-0 flex-1 border-0" />}
            </div>
          )}
          {right ?? <AiChatPanel className="h-full min-h-0 min-w-0 flex-1" />}
        </div>
      </div>
    </div>
  );
}
