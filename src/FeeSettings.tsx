// 설정 › 수수료 · 입금: 플랫폼마다 수수료율 · 기준 · 쿠폰 기본 부담 · 정산 주기, 카드 수수료율
import { useEffect, useState } from "react";
import type { HotelSettings, Platform } from "../shared/ledger";
import { normalizeDays, normalizeRate } from "../shared/feerate";
import { isOnsite } from "../shared/payment";
import { PlatBadge } from "./ui";

/** 수수료율 칸: '9.5'처럼 소수점을 적는 도중에도 글자가 안 사라지게 따로 들고 있어요 */
export function RateInput({ value, label, onChange }: { value: number | null | undefined; label: string; onChange: (v: number | null) => void }) {
  const [raw, setRaw] = useState(value != null ? String(value) : "");
  useEffect(() => {
    if (normalizeRate(raw) !== (value ?? null)) setRaw(value != null ? String(value) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="inp rate">
      <input
        className="num"
        inputMode="decimal"
        placeholder="없음"
        aria-label={label}
        value={raw}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 5);
          setRaw(v);
          onChange(normalizeRate(v));
        }}
        onBlur={() => setRaw(value != null ? String(value) : "")}
      />
      %
    </span>
  );
}

export default function FeeSettings({ s, update }: { s: HotelSettings; update: (fn: (x: HotelSettings) => HotelSettings) => void }) {
  const setP = (id: string, patch: Partial<Platform>) =>
    update((x) => ({
      ...x,
      platforms: x.platforms.map((y) => {
        if (y.id !== id) return y;
        const n: Platform = { ...y, ...patch };
        // 빈 값은 칸째로 빼요 (기본값과 같으면 저장 안 해요)
        if (n.feeRate == null) delete n.feeRate;
        if (n.feeBasis !== "net") delete n.feeBasis;
        if (!n.couponHotel) delete n.couponHotel;
        if (n.payoutDays == null) delete n.payoutDays;
        return n;
      }),
    }));
  return (
    <>
      <div className="feegrid">
        <div className="fg-h">
          <span>플랫폼</span>
          <span>수수료율</span>
          <span>수수료 기준</span>
          <span>기본 쿠폰 부담</span>
          <span>정산 주기</span>
        </div>
        {s.platforms.map((p) => (
          <div className={`fg-r ${p.feeRate ? "" : "off"}`} key={p.id}>
            <span className="fg-p">
              <PlatBadge p={p} />
              <b>{p.name || "이름 없음"}</b>
              {isOnsite(p) ? <small className="muted">현장 결제</small> : null}
            </span>
            <RateInput value={p.feeRate} label={`${p.name} 수수료율`} onChange={(v) => setP(p.id, { feeRate: v })} />
            <div className="seg sm" role="group" aria-label={`${p.name} 수수료 기준`}>
              <button type="button" className={p.feeBasis !== "net" ? "on" : ""} aria-pressed={p.feeBasis !== "net"} onClick={() => setP(p.id, { feeBasis: "sale" })}>
                판매가
              </button>
              <button type="button" className={p.feeBasis === "net" ? "on" : ""} aria-pressed={p.feeBasis === "net"} onClick={() => setP(p.id, { feeBasis: "net" })}>
                쿠폰 뺀 금액
              </button>
            </div>
            <div className="seg sm" role="group" aria-label={`${p.name} 기본 쿠폰 부담`}>
              <button type="button" className={!p.couponHotel ? "on" : ""} aria-pressed={!p.couponHotel} onClick={() => setP(p.id, { couponHotel: false })}>
                플랫폼 부담
              </button>
              <button type="button" className={p.couponHotel ? "on" : ""} aria-pressed={!!p.couponHotel} onClick={() => setP(p.id, { couponHotel: true })}>
                숙소 부담
              </button>
            </div>
            <span className="inp days">
              퇴실 후
              <input
                className="num"
                inputMode="numeric"
                placeholder="—"
                aria-label={`${p.name} 정산 주기 (퇴실 후 며칠)`}
                value={p.payoutDays ?? ""}
                onChange={(e) => setP(p.id, { payoutDays: normalizeDays(e.target.value.replace(/\D/g, "").slice(0, 2)) })}
              />
              일
            </span>
          </div>
        ))}
        {!s.platforms.length ? <div className="muted sm">플랫폼을 먼저 추가해 주세요</div> : null}
      </div>
      <div className="sub stimes-f">
        입금 예정가 = 판매가 − 수수료 − 숙소 부담 쿠폰. 수수료율을 비우면 수수료가 없어요. 정산 주기를 적으면 입금 예정일이 보여요. 공유 화면에는 안 보여요.
      </div>
      <div className="cardfee">
        <label>
          <span>카드 수수료율</span>
          <RateInput value={s.cardFeeRate} label="카드 수수료율" onChange={(v) => update((x) => ({ ...x, cardFeeRate: v }))} />
        </label>
        <span className="sub">HOTORI에 적은 현장 카드 결제(선금 · 잔금 · 단체 · 매점 카드)에만 붙어요. 플랫폼에서 결제한 예약에는 안 붙어요.</span>
      </div>
    </>
  );
}
