import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export type ChipTone = "sell" | "info" | "warn" | "danger" | "stop";

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** selected (.chip.on) */
  active?: boolean;
  sm?: boolean;
  /** semantic status color — chromatic when active; soft hint when idle */
  tone?: ChipTone;
  children: ReactNode;
};

/** Entry `.chip` / `.chip.on` / `.chip.sm` (+ optional `.tone-*` for status) */
export function Chip({ active, sm, tone, className, type = "button", children, ...rest }: ChipProps) {
  const cls = [
    "chip",
    sm ? "sm" : "",
    active ? "on" : "",
    tone ? `tone-${tone}` : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={cls} {...rest}>
      {children}
    </button>
  );
}

type ChipGroupProps = HTMLAttributes<HTMLDivElement> & {
  scroll?: boolean;
  children: ReactNode;
};

/** Entry `.chips` (+ optional `.scroll`) */
export function ChipGroup({ scroll, className, children, ...rest }: ChipGroupProps) {
  const cls = ["chips", scroll ? "scroll" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
