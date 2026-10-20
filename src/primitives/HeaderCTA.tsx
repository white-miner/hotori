import type { ButtonHTMLAttributes } from "react";
import { Plus } from "lucide-react";

type HeaderCTAProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** `.addbtn` header or `.fab` mobile */
  variant?: "header" | "fab";
  label?: string;
};

const ICON = { header: 17, fab: 19 } as const;

/**
 * Primary 「간단 예약」 CTA — Lucide Plus only (no emoji).
 * Gap = CSS `--cta-gap` on `.addbtn` / `.fab`.
 */
export function HeaderCTA({ variant = "header", label = "간단 예약", className, type = "button", ...rest }: HeaderCTAProps) {
  const base = variant === "fab" ? "fab" : "addbtn";
  const cls = [base, className].filter(Boolean).join(" ");
  return (
    <button type={type} className={cls} aria-keyshortcuts={variant === "header" ? "N" : undefined} {...rest}>
      <Plus size={ICON[variant]} strokeWidth={2.4} />
      {label}
    </button>
  );
}
