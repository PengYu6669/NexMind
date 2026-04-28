import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NexMind — AI 智能笔记",
  description: "个人 AI 第二大脑：笔记 / 知识库与对话打通",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="dark h-full" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=block"
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `document.fonts.ready.then(function(){document.documentElement.classList.add("fonts-loaded")})`,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
