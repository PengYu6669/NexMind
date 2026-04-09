import type { ReactNode } from "react";

export function WorkspacePlaceholder({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <section className="flex min-h-0 flex-1 flex-col items-center justify-center border-outline-variant/10 bg-surface px-6 py-12 text-center">
      <h2 className="font-headline text-xl font-bold text-on-surface">{title}</h2>
      {description ? (
        <div className="mt-3 max-w-md text-left text-sm leading-relaxed text-on-surface-variant">{description}</div>
      ) : null}
    </section>
  );
}
