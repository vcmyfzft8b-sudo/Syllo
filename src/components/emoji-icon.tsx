import type { CSSProperties } from "react";

export function EmojiIcon({
  symbol,
  label,
  size = "1em",
  className,
  style,
  decorative = true,
}: {
  symbol: string;
  label?: string;
  size?: CSSProperties["fontSize"];
  className?: string;
  style?: CSSProperties;
  decorative?: boolean;
}) {
  return (
    <span
      className={`emoji-icon ${className ?? ""}`.trim()}
      aria-hidden={decorative}
      aria-label={decorative ? undefined : label}
      role={decorative ? undefined : "img"}
      style={{ fontSize: size, ...style }}
    >
      {symbol}
    </span>
  );
}
