import { won } from "../shared/ledger";
import { type NowNightRate, nowRateText } from "../shared/nowCard";

/**
 * 객실 카드 사실 줄(글자 크기·색은 docs/room-card-spec.md §3). 정해 둔 순서: 객실번호 → 이용기간 → 연동 → 결제수단+금액 → 받아야 할 돈 → 투숙객 이름 → 회사명 → 하루 요금.
 * 그래서 두 번 놓아요: slot="top"(이용기간·연동·결제·받을 돈)은 이름 위에, slot="who"(회사·하루 요금)는 이름 아래에.
 * 각 줄은 자기 자리(data-slot)가 있어서 값이 없어도 빈 자리로 항상 그려요 — 줄이 생기거나 없어지지 않고, 자리 높이·위치는 styles.css의 `.rc-grid`가 고정해요 (§11).
 * 색은 항목으로 고정: 객실 가격=빨강(.amt-rate) · 받은 돈=검정(.amt-paid) · 받아야 할 돈=파랑(.amt-due).
 * 하루 요금은 이 객실 자기 박별 요금 (보는 날짜 기준). 총액·잔금을 이 자리에 쓰지 않아요.
 */
export default function RoomCardFacts({
  rate,
  payText,
  payTitle,
  tone,
  company,
  viewLabel,
  period,
  openEnded,
  due,
  linkLabel,
  slot = "all",
}: {
  /** 박당 요금 — 카드에 내용이 없으면(null) 자리만 비워 둬요 */
  rate: NowNightRate | null;
  payText: string | null;
  payTitle?: string;
  tone: "due" | "partial" | "paid" | "neutral";
  company: string | null;
  viewLabel: string;
  /** 배치 칸처럼 날짜 줄이 따로 없을 때 이용기간 한 줄 (현황은 날짜 버튼이 그 자리라서 넘기지 않아요) */
  period?: string;
  /** 퇴실 미정(열린 숙박): 「퇴실 미정」 표시 */
  openEnded?: boolean;
  /** 받아야 할 돈(미수금, 오늘 밤 기준) — 0보다 클 때만 파랑으로 채워요 */
  due?: number | null;
  /** 단체 구성원 카드: 대표객실을 가리키는 건물+호수 (예: `본관 602호`) — 연동 표시 한 줄 */
  linkLabel?: string | null;
  slot?: "top" | "who" | "all";
}) {
  const top = slot !== "who";
  const who = slot !== "top";
  const rt = rate ? nowRateText(rate) : null;
  const basisNote = rate?.basis === "flat" ? " · 1박 요금" : "";
  // 자리(slot)는 값이 있든 없든 항상 그려요 — 값이 없으면 빈 자리로 남고, 다른 줄이 위아래로 움직이지 않아요 (docs/room-card-spec.md §11)
  return (
    <>
      {top && period !== undefined ? (
        <div className="rc-period" data-slot="period" title={openEnded ? "퇴실 미정 — 끝나는 날이 아직 없어요" : "이용기간 · 몇째 밤/전체 박수"}>
          {period}
        </div>
      ) : null}
      {top ? (
        <div className="rc-link" data-slot="link" title={linkLabel ? "단체 · 대표객실과 연동된 객실이에요" : undefined}>
          {linkLabel ? `연동 ${linkLabel}` : null}
        </div>
      ) : null}
      {top ? (
        <div className="rc-pay amt-paid" data-slot="pay" data-tone={tone} title={payText ? (payTitle ?? "결제 수단 · 금액") : undefined}>
          {payText ? spacedPay(payText) : null}
        </div>
      ) : null}
      {top ? (
        <div className="rc-due amt-due" data-slot="due" title={!linkLabel && due != null && due > 0 ? "받아야 할 돈 (미수금 · 오늘 밤까지)" : undefined}>
          {!linkLabel && due != null && due > 0 ? (
            <>
              <span className="rc-due-k">받을 돈</span> {won(due)}
            </>
          ) : null}
        </div>
      ) : null}
      {who ? (
        <div className="rc-co" data-slot="company" title={!linkLabel && company ? `회사 · ${company}` : undefined}>
          {!linkLabel && company ? company : null}
        </div>
      ) : null}
      {who ? (
        <div
          className="rc-rate amt-rate"
          data-slot="rate"
          title={
            rate && rt
              ? `${viewLabel} 하루 객실 요금${rate.varies ? ` · 이 기간 ₩${won(rate.min)}~₩${won(rate.max)}` : ""}${basisNote}`
              : undefined
          }
        >
          {rate && rt ? (
            <>
              <span className="rc-rate-v">{rt}/박</span>
              {rate.varies ? (
                <i className="rc-var" aria-label="박마다 요금이 달라요">
                  변동
                </i>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/** 결제 수단과 금액 사이에 한 칸 (`이체690,000` → `이체 690,000`) — 보이는 글자만 바꿔요 */
export function spacedPay(t: string): string {
  return t.replace(/([^\d\s·,₩])(\d)/g, "$1 $2");
}
