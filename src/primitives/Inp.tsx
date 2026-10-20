import { forwardRef, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

type InpProps = InputHTMLAttributes<HTMLInputElement> & {
  sm?: boolean;
  className?: string;
};

/** Entry bare text `.inp` (이름·연락처·메모) */
export const Inp = forwardRef(function Inp({ sm, className, ...rest }: InpProps, ref: Ref<HTMLInputElement>) {
  const cls = ["inp", sm ? "sm" : "", className].filter(Boolean).join(" ");
  return <input ref={ref} className={cls} {...rest} />;
});

type PriceInpProps = {
  sm?: boolean;
  total?: boolean;
  className?: string;
  suffix?: ReactNode;
  children: ReactNode;
};

/** Entry `<label className="inp price …">` money shell */
export function PriceInp({ sm, total, className, suffix = "원", children }: PriceInpProps) {
  const cls = ["inp", "price", sm ? "sm" : "", total ? "price-total" : "", className].filter(Boolean).join(" ");
  return (
    <label className={cls}>
      {children}
      {suffix}
    </label>
  );
}

type GuestNamePhoneProps = {
  nameRef?: Ref<HTMLInputElement>;
  name: string;
  phone: string;
  onName: (v: string) => void;
  onPhone: (v: string) => void;
};

/** Entry `.two` 이름 · 연락처 pair */
export function GuestNamePhone({ nameRef, name, phone, onName, onPhone }: GuestNamePhoneProps) {
  return (
    <div className="two">
      <Inp
        ref={nameRef}
        value={name}
        onChange={(e) => onName(e.target.value)}
        placeholder="손님 이름"
        autoComplete="name"
        maxLength={60}
        aria-label="이름"
      />
      <Inp
        value={phone}
        onChange={(e) => onPhone(e.target.value)}
        placeholder="010-1234-5678"
        inputMode="tel"
        autoComplete="tel"
        maxLength={30}
        aria-label="연락처"
      />
    </div>
  );
}
