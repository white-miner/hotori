import type { ReactNode } from "react";
import { Minus, Plus } from "lucide-react";

type StepperProps = {
  value: number;
  unit?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
  onChange: (next: number) => void;
  /** extra after value (e.g. range hint) */
  children?: ReactNode;
  className?: string;
};

/** Entry `.step.gstep` guest count (− / value / +) */
export function Stepper({ value, unit = "명", min = 1, max, disabled, onChange, children, className }: StepperProps) {
  const cls = ["step", "gstep", className].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <button type="button" className="sb" aria-label={`1${unit} 줄이기`} onClick={() => onChange(value - 1)} disabled={disabled || value <= min}>
        <Minus size={16} />
      </button>
      <span className="sv">
        {value}
        <small>{unit}</small>
      </span>
      <button
        type="button"
        className="sb"
        aria-label={`1${unit} 늘리기`}
        onClick={() => onChange(value + 1)}
        disabled={disabled || (max != null && value >= max)}
      >
        <Plus size={16} />
      </button>
      {children}
    </div>
  );
}
