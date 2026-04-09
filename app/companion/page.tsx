import { redirect } from "next/navigation";

/** 旧路径 /companion 已更名为 /nextclaw */
export default function LegacyCompanionPage() {
  redirect("/nextclaw");
}
