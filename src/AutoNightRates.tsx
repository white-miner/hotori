/**
 * 간단 예약 — 박마다 자동 요금 (타입별). 누르면 그 박 금액만 직접 고쳐요.
 * 요금 계산은 shared/autoRate.ts · 우선순위: 특별일 > 시즌 > 평일/주말 > 기본
 */
import { useState } from "react";
import { type AutoNight, type AutoTypeLine } from "../shared/autoRate";
import { md, typeLabel, weekday, won, type RoomType } from "../shared/ledger";

const SRC_TEXT: Record<AutoNight["source"], string> = {
  date: "특별일",
  season: "시즌",
  weekend: "주말",
  weekday: "평일",
  flat: "기본",
  none: "미설정",
  manual: "직접",
};
const tag = (n: AutoNight) => (n.source === "season" && n.seasonName ? n.seasonName : SRC_TEXT[n.source]);

interface Props {
  lines: AutoTypeLine[];
  typeOf: (id: string) => RoomType | undefined;
  onEdit: (typeId: string, date: string, amount: number) => void;
}

export default function AutoNightRates({ lines, typeOf, onEdit }: Props) {
  const [edit, setEdit] = useState<{ typeId: string; date: string; v: string } | null>(null);
  const commit = () => {
    if (!edit) return;
    const amount = Math.max(0, Math.round(Number(edit.v.replace(/\D/g, "") || 0)));
    onEdit(edit.typeId, edit.date, amount);
    setEdit(null);
  };
  return (
    <div className="anr" aria-label="박별 요금">
      {lines.map((l) => {
        const t = typeOf(l.typeId);
        return (
          <div className="anr-type" key={l.typeId}>
            <div className="anr-h">
              <b>{t ? typeLabel(t) || t.name : l.typeId}</b>
              <span className="muted sm">
                {l.rooms > 1 ? `${l.rooms}실 · ` : ""}1실 {won(l.perRoom)}원
              </span>
            </div>
            <div className="anr-list" role="list">
              {l.nights.map((n) => {
                const editing = edit?.typeId === l.typeId && edit.date === n.date;
                return editing ? (
                  <div className="anr-n edit" role="listitem" key={n.date}>
                    <span className="anr-d">
                      {md(n.date)}({weekday(n.date)})
                    </span>
                    <input
                      className="num"
                      inputMode="numeric"
                      autoFocus
                      aria-label={`${md(n.date)} 요금`}
                      value={edit.v ? won(Number(edit.v)) : ""}
                      onChange={(e) => setEdit({ ...edit, v: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                      onBlur={commit}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.stopPropagation();
                          commit();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          e.stopPropagation();
                          setEdit(null);
                        }
                      }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    role="listitem"
                    key={n.date}
                    className={`anr-n ${n.amount <= 0 ? "none" : ""} ${n.source === "manual" ? "man" : ""}`}
                    aria-label={`${md(n.date)}(${weekday(n.date)}) ${n.amount > 0 ? `${won(n.amount)}원 ${tag(n)}` : "요금 없음"} · 눌러서 수정`}
                    onClick={() => setEdit({ typeId: l.typeId, date: n.date, v: n.amount > 0 ? String(n.amount) : "" })}
                  >
                    <span className="anr-d">
                      {md(n.date)}({weekday(n.date)})
                    </span>
                    <span className="num anr-a">{n.amount > 0 ? won(n.amount) : "—"}</span>
                    <span className={`anr-t s-${n.source}`}>{tag(n)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
