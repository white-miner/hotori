// 설정 › 인원 추가 요금: 객실 종류(일반 · 특수)별 평일 · 금·토·특별일 금액 + 특별일 달력
import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { HotelSettings } from "../shared/ledger";
import { SURCHARGE_MAX, TIER_NAME_MAX, isPeakNight, shortWon, tierLabel, tierSummary } from "../shared/surcharge";
import { uid } from "./ui";
import NumInput from "./NumInput";


export function TierSettings({ s, update, notify }: { s: HotelSettings; update: (fn: (x: HotelSettings) => HotelSettings) => void; notify: (m: string) => void }) {
  const setTier = (id: string, patch: Partial<HotelSettings["surchargeTiers"][number]>) =>
    update((x) => ({ ...x, surchargeTiers: x.surchargeTiers.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  return (
    <>
      <div className="tierhead">
        <span>객실 종류</span>
        <span>평일 (일~목 밤)</span>
        <span>주말 · 특별일 밤</span>
        <span />
      </div>
      {s.surchargeTiers.map((t) => (
        <div className="trow tierrow" key={t.id}>
          <input className="nin" value={tierLabel(t)} maxLength={TIER_NAME_MAX} placeholder="이름 (예: 특수)" aria-label="객실 종류 이름" onChange={(e) => setTier(t.id, { name: e.target.value })} />
          <label className="tierin">
            <NumInput aria-label={`${tierLabel(t)} 평일 1명 1박`} min={0} max={SURCHARGE_MAX} allowEmpty value={t.weekday || null} onChange={(v) => setTier(t.id, { weekday: v ?? 0 })} />원
          </label>
          <label className="tierin">
            <NumInput aria-label={`${tierLabel(t)} 금·토·특별일 1명 1박`} min={0} max={SURCHARGE_MAX} allowEmpty value={t.weekend || null} onChange={(v) => setTier(t.id, { weekend: v ?? 0 })} />원
          </label>
          <button
            className="ic"
            aria-label="객실 종류 지우기"
            onClick={() => {
              if (s.surchargeTiers.length <= 1) return notify("객실 종류는 하나 이상 있어야 해요");
              if (s.types.some((y) => y.tierId === t.id)) return notify(`'${tierLabel(t)}'을 쓰는 객실 타입이 있어요. 객실 타입에서 먼저 바꿔 주세요`);
              update((x) => ({ ...x, surchargeTiers: x.surchargeTiers.filter((y) => y.id !== t.id) }));
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button className="add" onClick={() => update((x) => ({ ...x, surchargeTiers: [...x.surchargeTiers, { id: uid("g"), name: "", weekday: 10000, weekend: 20000 }] }))}>
        <Plus size={14} />
        객실 종류 추가
      </button>
      <div className="muted sm tsum">{tierSummary(s.surchargeTiers, shortWon)}</div>
    </>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 특별일 달력: 날짜를 누르면 켜고 꺼요 (그 날 밤 숙박은 주말 요금) */
export function SpecialDates({ s, today, update }: { s: HotelSettings; today: string; update: (fn: (x: HotelSettings) => HotelSettings) => void }) {
  const [ym, setYm] = useState(() => today.slice(0, 7));
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${pad(i + 1)}`)];
  const go = (d: number) => {
    const t = new Date(Date.UTC(y, m - 1 + d, 1));
    setYm(`${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`);
  };
  const on = new Set(s.specialDates);
  const toggle = (d: string) =>
    update((x) => ({ ...x, specialDates: on.has(d) ? x.specialDates.filter((z) => z !== d) : [...x.specialDates, d].sort() }));
  const upcoming = s.specialDates.filter((d) => d >= today);
  return (
    <div className="spcal">
      <div className="spnav">
        <button className="ic" aria-label="이전 달" onClick={() => go(-1)}>
          <ChevronLeft size={16} />
        </button>
        <b>
          {y}년 {m}월
        </b>
        <button className="ic" aria-label="다음 달" onClick={() => go(1)}>
          <ChevronRight size={16} />
        </button>
      </div>
      <div className="spgrid">
        {"일월화수목금토".split("").map((w) => (
          <span className="w" key={w}>
            {w}
          </span>
        ))}
        {cells.map((d, i) =>
          d ? (
            <button
              key={d}
              type="button"
              className={`d ${on.has(d) ? "on" : isPeakNight(d, [], s.weekendDays) ? "wk" : ""} ${d === today ? "td" : ""}`}
              aria-pressed={on.has(d)}
              title={on.has(d) ? "특별일 · 누르면 꺼요" : isPeakNight(d, [], s.weekendDays) ? "주말 요일 밤은 원래 주말 요금이에요" : "누르면 특별일로 켜요"}
              onClick={() => toggle(d)}
            >
              {Number(d.slice(8))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
      <div className="muted sm">
        {upcoming.length ? `다가오는 특별일 ${upcoming.length}일 · ${upcoming.slice(0, 4).map((d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`).join(", ")}${upcoming.length > 4 ? " …" : ""}` : "특별일 없음 · 연휴·축제 날짜를 눌러 켜세요"}
      </div>
    </div>
  );
}
