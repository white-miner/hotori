// 판매 캘린더 ‘요금 설정’ 시트: 타입 고르고 → 평일/주말/기본 · 요일별(월~일) · 시즌 요금을 한 번에 저장해요.
// 설정 › 객실 요금과 같은 데이터(typeRates · typeSeasons)를 써서 항상 같이 바뀌어요.
import { useState } from "react";
import { CalendarRange, Plus, Trash2, X } from "lucide-react";
import { type HotelSettings, md, typeLabel, usableTypes, weekday } from "../shared/ledger";
import { RATE_MAX, type RateSeason, SEASON_NAME_MAX, SEASONS_PER_TYPE_MAX, normalizeWeekendDays, validateSeason, weekendDaysText } from "../shared/seasonRates";
import { type RateDraft, GRID_DAYS, applyRateDraft, dayName, dowFallback, draftFromSettings, hasDowValues, isDraftChanged } from "../shared/rateSheet";
import { Chip, ChipGroup } from "./primitives";
import { uid } from "./ui";
import NumInput from "./NumInput";

const span = (a: string, b: string) => {
  const n = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
  return `${md(a)}(${weekday(a)}) ~ ${md(b)}(${weekday(b)}) · ${n}일`;
};

export default function RateSheet({
  s,
  initialTypeId,
  busy,
  onClose,
  onSave,
}: {
  s: HotelSettings;
  initialTypeId?: string | null;
  busy: boolean;
  onClose: () => void;
  onSave: (next: HotelSettings) => Promise<void>;
}) {
  const types = usableTypes(s.types);
  const [typeId, setTypeId] = useState(() => (initialTypeId && types.some((t) => t.id === initialTypeId) ? initialTypeId : (types[0]?.id ?? "")));
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});
  const [dowOpen, setDowOpen] = useState<Record<string, boolean>>({});
  const [err, setErr] = useState("");
  const weekendDays = normalizeWeekendDays(s.weekendDays);
  const d = drafts[typeId] ?? draftFromSettings(s, typeId);
  const patch = (p: Partial<RateDraft>) => {
    setErr("");
    setDrafts((x) => ({ ...x, [typeId]: { ...(x[typeId] ?? draftFromSettings(s, typeId)), ...p } }));
  };
  const showDow = dowOpen[typeId] ?? hasDowValues(d);
  const dirty = Object.entries(drafts).some(([id, dr]) => isDraftChanged(s, id, dr));

  async function save() {
    let next = s;
    for (const [id, dr] of Object.entries(drafts)) {
      if (!isDraftChanged(s, id, dr)) continue;
      const r = applyRateDraft(next, id, dr);
      if (r.error) {
        setTypeId(id);
        setErr(`${typeLabel(s.types.find((t) => t.id === id))}: ${r.error}`);
        return;
      }
      next = r.next;
    }
    if (next === s) return onClose();
    await onSave(next);
  }

  const setSeason = (id: string, p: Partial<RateSeason>) => patch({ seasons: d.seasons.map((z) => (z.id === id ? { ...z, ...p } : z)) });
  const dirtyType = (id: string) => !!drafts[id] && isDraftChanged(s, id, drafts[id]!);

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sales-sheet rsh" role="dialog" aria-label="요금 설정">
        <div className="grab" />
        <div className="mh">
          <h2>요금 설정</h2>
          <span className="muted sm">타입마다 평일·주말·요일별 요금과 시즌 요금을 정해요</span>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        {!types.length ? (
          <p className="muted">객실 타입을 먼저 만들어 주세요.</p>
        ) : (
          <>
            <ChipGroup scroll>
              {types.map((t) => (
                <Chip key={t.id} sm active={t.id === typeId} onClick={() => setTypeId(t.id)}>
                  {typeLabel(t)}
                  {dirtyType(t.id) ? <i className="rsh-dot" aria-label="바뀜" /> : null}
                </Chip>
              ))}
            </ChipGroup>

            <div className="rsh-sec">
              <div className="rsh-h">기본 요금 <small>1박 · 원</small></div>
              <div className="rsh-three">
                <label className="tierin">
                  <span>평일</span>
                  <NumInput aria-label="평일 요금" min={0} max={RATE_MAX} allowEmpty value={d.weekday} onChange={(v) => patch({ weekday: v && v > 0 ? v : null })} />
                </label>
                <label className="tierin">
                  <span>주말</span>
                  <NumInput aria-label="주말 요금" min={0} max={RATE_MAX} allowEmpty value={d.weekend} onChange={(v) => patch({ weekend: v && v > 0 ? v : null })} />
                </label>
                <label className="tierin">
                  <span>공통 <small>(평일·주말이 비었을 때)</small></span>
                  <NumInput aria-label="공통 요금" min={0} max={RATE_MAX} allowEmpty value={d.flat} onChange={(v) => patch({ flat: v && v > 0 ? v : null })} />
                </label>
              </div>
            </div>

            <div className="rsh-sec">
              <div className="rsh-h">
                요일별 요금 <small>월~일 · 비우면 평일/주말 요금을 따라요</small>
                <button type="button" className="chip sm" aria-expanded={showDow} onClick={() => setDowOpen((o) => ({ ...o, [typeId]: !showDow }))}>
                  {showDow ? "접기" : "요일별로 다르게"}
                </button>
              </div>
              {showDow ? (
                <>
                  <div className="rsh-dow" role="group" aria-label="요일별 요금">
                    {GRID_DAYS.map((i) => {
                      const we = weekendDays.includes(i);
                      return (
                        <label key={i} className={`rsh-day${we ? " we" : ""}`}>
                          <span>{dayName(i)}</span>
                          <NumInput
                            aria-label={`${dayName(i)}요일 요금`}
                            min={0}
                            max={RATE_MAX}
                            allowEmpty
                            value={d.dow[i] ?? null}
                            placeholder={dowFallback(d, i, weekendDays)?.toLocaleString("ko-KR") ?? "—"}
                            onChange={(v) => patch({ dow: d.dow.map((x, k) => (k === i ? (v && v > 0 ? v : null) : x)) })}
                          />
                        </label>
                      );
                    })}
                  </div>
                  <div className="muted sm">
                    주말 밤은 <b>{weekendDaysText(weekendDays)}</b> (설정 › 객실 요금에서 바꿔요). 특별일로 켠 날은 요일별 값 대신 주말 요금을 써요.
                  </div>
                </>
              ) : null}
            </div>

            <div className="rsh-sec">
              <div className="rsh-h">
                <CalendarRange size={13} /> 시즌 요금 <small>기간 안에서는 위 요금 대신 써요 · 기간 겹침 불가</small>
              </div>
              {d.seasons.map((z) => {
                const others = d.seasons.filter((o) => o.id !== z.id);
                const e = z.name || z.from || z.to || z.weekday || z.weekend ? validateSeason(z, others) : null;
                return (
                  <div key={z.id} className={`rs-season${e ? " bad" : ""}`}>
                    <div className="rs-srow">
                      <input className="nin rs-sname" value={z.name} maxLength={SEASON_NAME_MAX} placeholder="시즌 이름 (예: 성수기)" aria-label="시즌 이름" onChange={(ev) => setSeason(z.id, { name: ev.target.value.slice(0, SEASON_NAME_MAX) })} />
                      <button type="button" className="ic" aria-label="시즌 삭제" onClick={() => patch({ seasons: d.seasons.filter((o) => o.id !== z.id) })}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="rs-dates">
                      <label>
                        <span>시작</span>
                        <input type="date" value={z.from} aria-label="시즌 시작일" onChange={(ev) => setSeason(z.id, { from: ev.target.value })} />
                      </label>
                      <i aria-hidden>~</i>
                      <label>
                        <span>끝 (그날 밤까지)</span>
                        <input type="date" value={z.to} min={z.from || undefined} aria-label="시즌 끝나는 날" onChange={(ev) => setSeason(z.id, { to: ev.target.value })} />
                      </label>
                    </div>
                    <div className="rs-rates">
                      <label className="tierin">
                        <span>평일</span>
                        <NumInput aria-label={`${z.name || "시즌"} 평일 요금`} min={0} max={RATE_MAX} allowEmpty value={z.weekday} onChange={(v) => setSeason(z.id, { weekday: v && v > 0 ? v : null })} />원
                      </label>
                      <label className="tierin">
                        <span>주말</span>
                        <NumInput aria-label={`${z.name || "시즌"} 주말 요금`} min={0} max={RATE_MAX} allowEmpty value={z.weekend} placeholder="평일과 같음" onChange={(v) => setSeason(z.id, { weekend: v && v > 0 ? v : null })} />원
                      </label>
                    </div>
                    {e ? (
                      <div className="rs-err" role="alert">{e}</div>
                    ) : z.from && z.to && z.from <= z.to ? (
                      <div className="muted sm">{span(z.from, z.to)}</div>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="button"
                className="add"
                onClick={() => {
                  if (d.seasons.length >= SEASONS_PER_TYPE_MAX) return setErr(`시즌은 타입마다 최대 ${SEASONS_PER_TYPE_MAX}개까지예요`);
                  patch({ seasons: [...d.seasons, { id: uid("z"), name: "", from: "", to: "", weekday: null, weekend: null }] });
                }}
              >
                <Plus size={14} /> 시즌 추가
              </button>
            </div>

            <p className="muted sm rsh-note">
              저장해도 이미 만든 예약의 요금은 바뀌지 않아요. 새 예약부터 적용돼요. 특정 날짜만 다르게 하려면 달력에서 그 날짜의 타입 카드를 눌러 <b>특별일 요금</b>을 정해요.
            </p>
            {err ? <div className="rs-err" role="alert">{err}</div> : null}
            <div className="actrow">
              <button type="button" className="btn line" onClick={onClose}>
                취소
              </button>
              <button type="button" className="btn red" disabled={busy || !dirty} onClick={() => void save()}>
                저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
