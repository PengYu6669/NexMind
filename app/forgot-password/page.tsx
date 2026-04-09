import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "忘记密码 · NexMind",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface px-6 font-body text-on-surface">
      <div className="w-full max-w-md rounded-xl border border-outline-variant/10 bg-surface-container-low p-8">
        <h1 className="font-headline text-xl font-bold">重置访问密钥</h1>
        <p className="mt-2 text-sm text-on-surface-variant">邮件重置流程将在此接入；当前为占位页。</p>
        <Link
          href="/login"
          className="mt-6 inline-block text-sm font-medium text-primary hover:underline"
        >
          返回登录
        </Link>
      </div>
    </div>
  );
}
