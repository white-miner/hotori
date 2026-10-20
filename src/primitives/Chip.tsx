import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** selected (.chip.on) */
  active?: boolean;
  sm?: boolean;
  children: ReactNode;
};

/** Entry `.chip` / `.chip.on` / `.chip.sm` */
export function Chip({ active, sm, className, type = "button", children, ...rest }: ChipProps) {
  const cls = ["chip", sm ? "sm" : "", active ? "on" : "", className].filter(Boolean).join(" ");
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
