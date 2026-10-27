import { OPEN_BADGE, OPEN_HOLD_CHOICES, openStayHint } from "../shared/openStay";

/**
 * 이용 기간 미정 — 퇴실일을 안 정하고 예약해요. 켜면 박수 입력은 숨고 「∞ 미정」으로 보여요.
 * 방 보호 = 방을 비워 두는 여유일 뿐 결제 주기가 아니에요.
 */
export default function OpenStayToggle({
  on,
  hold,
  onChange,
  disabled,
}: {
  on: boolean;
  hold: number;
  onChange: (on: boolean, hold: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ost" role="group" aria-label="이용 기간 미정">
      <button type="button" className={`chip ost-btn${on ? " on" : ""}`} aria-pressed={on} disabled={disabled} onClick={() => onChange(!on, hold)} title="끝 날짜를 정하지 않고 계속 묵어요">
        {OPEN_BADGE} · 이용 기간 미정
      </button>
      {on ? (
        <>
          <span className="ost-hold" role="group" aria-label="방 보호">
            <span className="muted sm">방 보호</span>
            {OPEN_HOLD_CHOICES.map((n) => (
              <button key={n} type="button" className={`chip sm${hold === n ? " on" : ""}`} aria-pressed={hold === n} onClick={() => onChange(true, n)}>
                {n === 0 ? "오늘 밤만" : `${n}일`}
              </button>
            ))}
          </span>
          <span className="muted sm ost-hint">{openStayHint(hold)}</span>
        </>
      ) : null}
    </div>
  );
}
