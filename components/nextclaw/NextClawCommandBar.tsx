"use client";

import { useMemo, useState } from "react";
import { Command, Search } from "lucide-react";

export function NextClawCommandBar({
  placeholder = "输入指令或搜索知识点...",
  disabled,
  onSubmit,
}: {
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  const kbd = useMemo(
    () => (
      <span className="hidden items-center gap-1 sm:flex">
        <kbd className="rounded-md border border-outline-variant/30 bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-bold text-outline">
          ⌘
        </kbd>
        <kbd className="rounded-md border border-outline-variant/30 bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-bold text-outline">
          K
        </kbd>
      </span>
    ),
    [],
  );

  return (
    <form
      className="flex w-full max-w-[760px] min-w-0 items-center gap-2 rounded-xl border border-outline-variant/15 bg-surface-container-lowest/40 px-3 py-2.5 backdrop-blur-xl disabled:opacity-50"
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        const text = value.trim();
        if (!text) return;
        onSubmit?.(text);
        setValue("");
      }}
    >
      <span className="flex items-center gap-2 text-outline">
        <Command className="h-4 w-4" />
        <Search className="h-4 w-4" />
      </span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm text-on-surface outline-none placeholder:text-outline/40 disabled:cursor-not-allowed"
        aria-label="Command Bar"
      />
      {kbd}
    </form>
  );
}

