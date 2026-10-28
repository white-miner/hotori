import { won } from "../shared/ledger";
import { type NowNightRate, nowRateText } from "../shared/nowCard";

/**
 * 객실 카드 아래쪽 사실 줄: 회사명 · 하루 객실 요금 · 결제수단+금액 · 받아야 할 돈.
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
}: {
  rate: NowNightRate;
  payText: string | null;
  payTitle?: string;
  tone: "due" | "partial" | "paid" | "neutral";
  company: string | null;
  viewLabel: string;
  /** 배치 칸처럼 날짜 줄이 따로 없을 때 이용기간 한 줄 */
  period?: string;
  /** 퇴실 미정(열린 숙박): 「퇴실 미정」 표시 */
  openEnded?: boolean;
  /** 받아야 할 돈(미수금, 오늘 밤 기준) — 0보다 클 때만 파랑으로 한 줄 */
  due?: number | null;
}) {
  const rt = nowRateText(rate);
  const basisNote = rate.basis === "avg" ? " · 박별 요금이 없어 객실료 ÷ 박수로 추정" : rate.basis === "flat" ? " · 1박 요금" : "";
  return (
    <>
      {period || openEnded ? (
        <div className="rc-co rc-period">
          {period}
          {openEnded ? <i className="rc-var open">퇴실 미정</i> : null}
        </div>
      ) : null}
      {company ? (
        <div className="rc-co" title={`회사 · ${company}`}>
          {company}
        </div>
      ) : null}
      {rt ? (
        <div className="rc-rate amt-rate" title={`${viewLabel} 하루 객실 요금${rate.varies ? ` · 이 기간 ₩${won(rate.min)}~₩${won(rate.max)}` : ""}${basisNote}`}>
          <span className="rc-rate-v">{rt}</span>
          {rate.varies ? (
            <i className="rc-var" aria-label="박마다 요금이 달라요">
              변동
            </i>
          ) : null}
          {rate.basis === "avg" ? <i className="rc-var est">추정</i> : null}
        </div>
      ) : null}
      {payText ? (
        <div className="nowamt rc-pay amt-paid" data-tone={tone} title={payTitle ?? "결제 수단 · 금액"}>
          {payText}
        </div>
      ) : null}
      {due != null && due > 0 ? (
        <div className="nowamt rc-due amt-due" title="받아야 할 돈 (미수금 · 오늘 밤까지)">
          <span className="rc-due-k">받을 돈</span> {won(due)}
        </div>
      ) : null}
    </>
  );
}
