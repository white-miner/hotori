// 설정 › 수수료 · 입금: 플랫폼마다 수수료율 · 기준 · 쿠폰 기본 부담 · 정산 주기, 카드 수수료율
import type { HotelSettings, Platform } from "../shared/ledger";
import { PAYOUT_DAYS_MAX, RATE_MAX, normalizeDays, normalizeRate } from "../shared/feerate";
import NumInput from "./NumInput";
import { isOnsite } from "../shared/payment";
import { PlatBadge } from "./ui";

/** 수수료율 칸: 입력하는 동안 글자 그대로 ('9.5'도), 칸을 벗어날 때 0.01~50으로. 비우면 없음 */
export function RateInput({ value, label, onChange }: { value: number | null | undefined; label: string; onChange: (v: number | null) => void }) {
  return (
    <span className="inp rate">
      <NumInput aria-label={label} placeholder="없음" decimal min={0.01} max={RATE_MAX} allowEmpty format={(n) => String(n)} value={value} onChange={(v) => onChange(normalizeRate(v))} />
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
              <NumInput placeholder="—" aria-label={`${p.name} 정산 주기 (퇴실 후 며칠)`} min={0} max={PAYOUT_DAYS_MAX} allowEmpty format={(n) => String(n)} value={p.payoutDays} onChange={(v) => setP(p.id, { payoutDays: normalizeDays(v) })} />
              일
            </span>
          </div>
        ))}
        {!s.platforms.length ? <div className="muted sm">플랫폼을 먼저 추가해 주세요</div> : null}
      </div>
      <div className="sub stimes-f">
        입금 예정가 = 판매가 − 수수료 − 숙소 부담 쿠폰. 수수료율을 비우면 수수료가 없어요. 정산 주기를 입력하면 입금 예정일이 보여요. 공유 화면에는 안 보여요.
      </div>
      <div className="cardfee">
        <label>
          <span>카드 수수료율</span>
          <RateInput value={s.cardFeeRate} label="카드 수수료율" onChange={(v) => update((x) => ({ ...x, cardFeeRate: v }))} />
        </label>
        <span className="sub">HOTORI에 등록한 현장 카드 결제(선금 · 잔금 · 단체 · 매점 카드)에만 붙어요. 플랫폼에서 결제한 예약에는 안 붙어요.</span>
      </div>
    </>
  );
}
