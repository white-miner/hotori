import type { HTMLAttributes, ReactNode } from "react";

type PriceRowProps = HTMLAttributes<HTMLDivElement> & {
  wdwe?: boolean;
  children: ReactNode;
};

/** Entry `.price-row` (+ optional `.wdwe`) */
export function PriceRow({ wdwe, className, children, ...rest }: PriceRowProps) {
  const cls = ["price-row", wdwe ? "wdwe" : "", className].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
