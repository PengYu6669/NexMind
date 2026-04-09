import { redirect } from "next/navigation";

/** 归档入口已下线，旧链接跳转到知识库 */
export default function ArchivePage() {
  redirect("/notes");
}
