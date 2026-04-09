import type { CSSProperties } from "react";

type MaterialIconProps = {
  name: string;
  className?: string;
  filled?: boolean;
  style?: CSSProperties;
};

export function MaterialIcon({ name, className = "", filled = false, style }: MaterialIconProps) {
  return (
    <span
      className={`material-symbols-outlined ${className}`.trim()}
      aria-hidden
      style={{
        ...(filled ? { fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" } : undefined),
        ...style,
      }}
    >
      {name}
    </span>
  );
}
