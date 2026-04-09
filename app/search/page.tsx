import { redirect } from "next/navigation";

/** 旧「语义搜索」独立页已并入知识库侧栏；保留路由避免外链失效 */
export default async function SearchRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const trimmed = q?.trim();
  if (trimmed) {
    redirect(`/notes?q=${encodeURIComponent(trimmed)}`);
  }
  redirect("/notes");
}
