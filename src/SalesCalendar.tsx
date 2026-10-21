/**
 * 판매 캘린더 — 숙박일 우선 (날짜 열 × 타입 카드).
 * 다날짜 선택 → 일괄 요금·판매중지 · 「판매」뱃지 · 예약/재고 · 간단 예약 Path A.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { Ban, CalendarPlus, Check, ChevronDown, ChevronUp, X } from "lucide-react";
import {
  type Booking,
  type HotelSettings,
  dayLabel,
  md,
  stockLevel,
  typeLabel,
  weekday,
  weekStart,
  won,
} from "../shared/ledger";
import {
  applyBulkTypeDates,
  baseRateFor,
  bookedCount,
  isSellOpen,
  isStopSell,
  isWeekendNight,
  sellableRemaining,
  setTypeDateRate,
  setTypeRateDefaults,
  setTypeStopSell,
  typeRateDefaults,
} from "../shared/salesCalendar";
import type { HotelData } from "./data";
import { Chip, ChipGroup, PriceInp, PriceRow } from "./primitives";
import { TypeBadge } from "./ui";

type CellKey = { typeId: string; date: string };
type StopMode = "keep" | "open" | "stop";

interface Props {
  data: HotelData;
  s: HotelSettings;
  today: string;
  selDate: string;
  viewDates: string[];
  viewTable: Map<string, Map<string, number>>;
  totals: Map<string, number>;
  scopeId: string | null;
  unassigned: number;
  readOnly?: boolean;
  rangeNav: ReactNode;
  buildingTabs: ReactNode;
  periodSeg: ReactNode;
  banner: ReactNode;
  tabs: ReactNode;
  bName: (id: string) => string;
  over: { date: string; type: { id: string; name?: string }; over: number } | null;
  wideRef: RefObject<HTMLDivElement | null>;
  notify: (m: string) => void;
  onSimple: (preset?: Partial<Booking>) => void;
}

export default function SalesCalendar({
  data,
  s,
  today,
  selDate,
  viewDates,
  viewTable,
  totals,
  scopeId,
  unassigned,
  readOnly = false,
  rangeNav,
  buildingTabs,
  periodSeg,
  banner,
  tabs,
  bName,
  over,
  wideRef,
  notify,
  onSimple,
}: Props) {
  const [cell, setCell] = useState<CellKey | null>(null);
  const [typeEdit, setTypeEdit] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const types = useMemo(
    () => s.types.filter((t) => (totals.get(t.id) ?? 0) > 0 || (!scopeId && typeLabel(t))),
    [s.types, totals, scopeId],
  );

  /** 월~일 주 밴드 — 이번 주가 첫 줄, 지난 주는 접힘 */
  const weekBands = useMemo(() => {
    const map = new Map<string, string[]>();
    const order: string[] = [];
    for (const d of viewDates) {
      const ws = weekStart(d);
      let list = map.get(ws);
      if (!list) {
        list = [];
        map.set(ws, list);
        order.push(ws);
      }
      list.push(d);
    }
    return order.map((start) => ({ start, dates: map.get(start)! }));
  }, [viewDates]);

  const todayWeek = weekStart(today);
  const pastWeeks = useMemo(() => weekBands.filter((w) => w.start < todayWeek), [weekBands, todayWeek]);
  const liveWeeks = useMemo(() => weekBands.filter((w) => w.start >= todayWeek), [weekBands, todayWeek]);
  /** 오늘이 창에 있을 때만 지난 주 접기 — 과거만 보면 전부 펼침 */
  const collapsePast = pastWeeks.length > 0 && liveWeeks.length > 0;
  const visibleWeeks = collapsePast ? (pastOpen ? [...pastWeeks, ...liveWeeks] : liveWeeks) : weekBands;

  useEffect(() => {
    setPastOpen(false);
  }, [viewDates[0], viewDates[viewDates.length - 1]]);

  /** 타입별 창 안 최소 판매가능 칸 — 한눈에 */
  const glance = useMemo(() => {
    const m = new Map<string, { min: number; stopped: number; total: number }>();
    for (const t of types) {
      let min = Infinity;
      let stopped = 0;
      for (const d of viewDates) {
        const rem = viewTable.get(t.id)?.get(d) ?? 0;
        const st = isStopSell(s, t.id, d);
        if (st) stopped += 1;
        const sell = sellableRemaining(rem, st);
        if (sell < min) min = sell;
      }
      m.set(t.id, { min: Number.isFinite(min) ? min : 0, stopped, total: totals.get(t.id) ?? 0 });
    }
    return m;
  }, [types, viewDates, viewTable, s, totals]);

  function toggleDate(d: string) {
    if (readOnly) return;
    setPicked((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));
  }

  async function saveSettings(next: HotelSettings, ok: string) {
    if (readOnly) return;
    setBusy(true);
    try {
      await data.saveHotel({ settings: next });
      notify(ok);
    } catch {
      notify("저장하지 못했어요. 다시 해 주세요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`page board-page one ${picked.length ? "sales-picking" : ""}`}>
      <div className="main">
        {tabs}
        {banner}
        <div className="hl">
          <div>
            <div className="hl-t">
              <h1>판매 캘린더</h1>
              {periodSeg}
            </div>
            <div className="when">
              {scopeId ? `${bName(scopeId)} · ` : ""}숙박일별 타입 · 예약/재고 · 기본 단가 · 판매중지
            </div>
            {over ? null : <div className="hl-ok">이 창 오버부킹 없음</div>}
            <p className="muted sm sales-hint">여기 숫자는 타입 기본가예요. 예약마다 방 요금은 따로 둘 수 있어요.</p>
          </div>
          <div className="lg">
            <span>
              <i className="lv-sell">판매</i>판매 가능
            </span>
            <span>
              <i className="lv-ok bordered">5</i>여유
            </span>
            <span>
              <i className="lv-low">2</i>적음 ({s.lowThreshold}실 이하)
            </span>
            <span>
              <i className="lv-full">0</i>만실
            </span>
            <span>
              <i className="lv-over">−1</i>초과
            </span>
            <span>
              <i className="lv-stop">
                <Ban size={12} strokeWidth={2.4} />
              </i>
              판매중지
            </span>
          </div>
        </div>

        <div className="sales-glance" aria-label="타입별 재고">
          {types.map((t) => {
            const g = glance.get(t.id)!;
            const lv = stockLevel(g.min, g.total, s.lowThreshold);
            return (
              <button
                key={t.id}
                type="button"
                className={`sales-gchip lv-${lv}`}
                onClick={() => !readOnly && setTypeEdit(t.id)}
                title={readOnly ? undefined : "평일·주말 기본 요금"}
              >
                <TypeBadge t={t} />
                <b className="num">{g.min < 0 ? `−${-g.min}` : g.min}</b>
                <small>칸~ · {g.total}실{g.stopped ? ` · 중지 ${g.stopped}` : ""}</small>
              </button>
            );
          })}
        </div>

        {rangeNav}
        {buildingTabs}
        {scopeId && unassigned ? (
          <div className="b-note">미배정 {unassigned}건은 호텔 전체 재고에서만 차감돼요 · 건물 탭에서는 '전체'에만 보여요.</div>
        ) : null}

        <div ref={wideRef} className="sales-dates" aria-label="숙박일별 타입 재고">
          {collapsePast ? (
            <button
              type="button"
              className="sales-past-toggle"
              aria-expanded={pastOpen}
              onClick={() => setPastOpen((o) => !o)}
            >
              {pastOpen ? <ChevronUp size={14} strokeWidth={2.4} /> : <ChevronDown size={14} strokeWidth={2.4} />}
              <span>지난 주 {pastWeeks.length}주</span>
            </button>
          ) : null}
          {visibleWeeks.map((band) => (
            <div
              key={band.start}
              className={`sales-week${band.start === todayWeek ? " cur" : ""}`}
              role="list"
            >
              {band.dates.map((d) => {
                const we = isWeekendNight(d, s.specialDates);
                const dayWe = ["토", "일"].includes(weekday(d));
                const on = picked.includes(d);
                const past = d < today;
                return (
                  <section
                    key={d}
                    className={`sales-day${past ? " past" : ""}${d === selDate ? " sel" : ""}${d === today ? " td" : ""}${dayWe || we ? " we" : ""}${weekday(d) === "토" ? " sa" : ""}${weekday(d) === "일" ? " su" : ""}${on ? " pick" : ""}`}
                    role="listitem"
                  >
                    <button
                      type="button"
                      className="sales-day-h"
                      onClick={() => toggleDate(d)}
                      aria-pressed={on}
                      title={readOnly ? dayLabel(d) : on ? "선택 해제" : "날짜 선택 (일괄 적용)"}
                      disabled={readOnly}
                    >
                      <b>{md(d)}</b>
                      <span>{d === today ? "오늘" : weekday(d)}</span>
                      {on ? (
                        <span className="sales-day-check" aria-hidden>
                          <Check size={12} strokeWidth={2.6} />
                        </span>
                      ) : null}
                    </button>
                    <div className="sales-day-types">
                      {types.map((t) => {
                        const total = totals.get(t.id) ?? 0;
                        const rem = viewTable.get(t.id)?.get(d) ?? 0;
                        const booked = bookedCount(total, rem);
                        const stopped = isStopSell(s, t.id, d);
                        const sell = sellableRemaining(rem, stopped);
                        const open = isSellOpen(rem, stopped);
                        const rate = baseRateFor(s, t.id, d);
                        const lv = stopped ? "stop" : stockLevel(rem, total, s.lowThreshold);
                        return (
                          <button
                            key={t.id}
                            type="button"
                            className={`sales-tcard lv-${lv}`}
                            onClick={() => setCell({ typeId: t.id, date: d })}
                            title={`${dayLabel(d)} · ${typeLabel(t)} · 예약 ${booked} / 재고 ${rem} · ${stopped ? "판매중지" : open ? "판매" : `${sell}칸`} · ${rate ? won(rate) + "원" : "요금 미정"}`}
                          >
                            <span className="sales-tcard-type">
                              <TypeBadge t={t} />
                              {open ? <span className="sales-badge-sell">판매</span> : null}
                              {stopped ? (
                                <span className="sales-badge-stop">
                                  <Ban size={11} strokeWidth={2.4} />
                                  중지
                                </span>
                              ) : null}
                            </span>
                            <span className="sales-tcard-stock num">
                              <span className="sales-booked">예약 {booked < 0 ? `−${-booked}` : booked}</span>
                              <span className="sales-stock-sep"> / </span>
                              <span className="sales-remain">재고 {rem < 0 ? `−${-rem}` : rem}</span>
                            </span>
                            <span className="sales-tcard-meta">
                              <span className="sales-tcard-rate">{rate > 0 ? won(rate) : "—"}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          ))}
        </div>
        <p className="stock-hint">
          {readOnly
            ? "타입을 누르면 요금·판매 상태를 볼 수 있어요"
            : picked.length
              ? `숙박일 ${picked.length}일 선택 · 아래에서 일괄 적용 · 타입 카드는 간단 예약`
              : "날짜 헤더로 여러 날 선택 · 타입 카드는 요금·판매중지·간단 예약"}
        </p>
      </div>

      {picked.length && !readOnly ? (
        <BulkApplyBar
          types={types}
          dates={picked}
          busy={busy}
          onClear={() => setPicked([])}
          onApply={async (typeIds, patch) => {
            const n = typeIds.length * picked.length;
            await saveSettings(
              applyBulkTypeDates(s, typeIds, picked, patch),
              `${typeIds.length}타입 · ${picked.length}일 (${n}칸)에 적용했어요`,
            );
            setPicked([]);
          }}
        />
      ) : null}

      {cell ? (
        <CellSheet
          s={s}
          typeId={cell.typeId}
          date={cell.date}
          remaining={viewTable.get(cell.typeId)?.get(cell.date) ?? 0}
          total={totals.get(cell.typeId) ?? 0}
          readOnly={readOnly}
          busy={busy}
          onClose={() => setCell(null)}
          onSaveRate={async (amt) => {
            await saveSettings(setTypeDateRate(s, cell.typeId, cell.date, amt), "숙박일 요금을 저장했어요");
          }}
          onToggleStop={async (on) => {
            await saveSettings(setTypeStopSell(s, cell.typeId, cell.date, on), on ? "판매중지했어요" : "판매를 다시 열었어요");
          }}
          onBook={() => {
            const rate = baseRateFor(s, cell.typeId, cell.date);
            const stopped = isStopSell(s, cell.typeId, cell.date);
            if (stopped) {
              notify("판매중지된 숙박일이에요. 중지를 푼 뒤 예약하세요.");
              return;
            }
            onSimple({
              kind: "stay",
              typeId: cell.typeId,
              checkIn: cell.date,
              nights: 1,
              roomId: null,
              nightRates: rate > 0 ? { flat: rate } : null,
            });
            setCell(null);
          }}
        />
      ) : null}

      {typeEdit ? (
        <TypeRateSheet
          s={s}
          typeId={typeEdit}
          readOnly={readOnly}
          busy={busy}
          onClose={() => setTypeEdit(null)}
          onSave={async (wd, we, flat) => {
            await saveSettings(
              setTypeRateDefaults(s, typeEdit, { weekday: wd, weekend: we, flat }),
              "타입 기본 요금을 저장했어요",
            );
            setTypeEdit(null);
          }}
        />
      ) : null}
    </main>
  );
}

function BulkApplyBar({
  types,
  dates,
  busy,
  onClear,
  onApply,
}: {
  types: HotelSettings["types"];
  dates: string[];
  busy: boolean;
  onClear: () => void;
  onApply: (
    typeIds: string[],
    patch: { rate?: number | null; stopSell?: boolean },
  ) => Promise<void>;
}) {
  const [typeIds, setTypeIds] = useState<string[]>(() => types.map((t) => t.id));
  const [rateStr, setRateStr] = useState("");
  const [stopMode, setStopMode] = useState<StopMode>("keep");

  useEffect(() => {
    setTypeIds((prev) => {
      const ids = new Set(types.map((t) => t.id));
      const keep = prev.filter((id) => ids.has(id));
      return keep.length ? keep : types.map((t) => t.id);
    });
  }, [types]);

  function toggleType(id: string) {
    setTypeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const canApply =
    typeIds.length > 0 && (rateStr !== "" || stopMode !== "keep") && !busy;

  return (
    <div className="sales-bulk" role="region" aria-label="선택한 숙박일 일괄 적용">
      <div className="sales-bulk-h">
        <strong>판매 설정 · {dates.length}일</strong>
        <span className="muted sm">{dates.map(md).join(", ")}</span>
        <button type="button" className="chip sm" onClick={onClear} disabled={busy}>
          선택 해제
        </button>
      </div>
      <div className="fld">
        <label>타입</label>
        <ChipGroup scroll>
          {types.map((t) => (
            <Chip key={t.id} sm active={typeIds.includes(t.id)} disabled={busy} onClick={() => toggleType(t.id)}>
              <TypeBadge t={t} />
              {typeLabel(t)}
            </Chip>
          ))}
        </ChipGroup>
      </div>
      <div className="fld">
        <label>기본 1박 요금 (비우면 유지)</label>
        <PriceInp sm>
          <input
            className="num"
            inputMode="numeric"
            aria-label="일괄 1박 요금"
            value={rateStr !== "" ? won(Number(rateStr) || 0) : ""}
            placeholder="변경 안 함"
            disabled={busy}
            onChange={(e) => setRateStr(e.target.value.replace(/\D/g, "").slice(0, 9))}
          />
        </PriceInp>
      </div>
      <div className="fld">
        <label>판매</label>
        <ChipGroup>
          <Chip sm active={stopMode === "keep"} disabled={busy} onClick={() => setStopMode("keep")}>
            유지
          </Chip>
          <Chip sm tone="sell" active={stopMode === "open"} disabled={busy} onClick={() => setStopMode("open")}>
            판매 열기
          </Chip>
          <Chip sm tone="stop" active={stopMode === "stop"} disabled={busy} onClick={() => setStopMode("stop")}>
            <Ban size={14} strokeWidth={2.2} />
            판매중지
          </Chip>
        </ChipGroup>
      </div>
      <div className="actrow">
        <button type="button" className="btn line" onClick={onClear} disabled={busy}>
          취소
        </button>
        <button
          type="button"
          className="btn red"
          disabled={!canApply}
          onClick={() => {
            const patch: { rate?: number | null; stopSell?: boolean } = {};
            if (rateStr !== "") patch.rate = Number(rateStr) || null;
            if (stopMode === "open") patch.stopSell = false;
            if (stopMode === "stop") patch.stopSell = true;
            void onApply(typeIds, patch);
          }}
        >
          적용
        </button>
      </div>
    </div>
  );
}

function CellSheet({
  s,
  typeId,
  date,
  remaining,
  total,
  readOnly,
  busy,
  onClose,
  onSaveRate,
  onToggleStop,
  onBook,
}: {
  s: HotelSettings;
  typeId: string;
  date: string;
  remaining: number;
  total: number;
  readOnly: boolean;
  busy: boolean;
  onClose: () => void;
  onSaveRate: (amt: number | null) => Promise<void>;
  onToggleStop: (on: boolean) => Promise<void>;
  onBook: () => void;
}) {
  const t = s.types.find((x) => x.id === typeId);
  const stopped = isStopSell(s, typeId, date);
  const rate = baseRateFor(s, typeId, date);
  const override = s.typeRateOverrides?.[typeId]?.[date];
  const booked = bookedCount(total, remaining);
  const [rateStr, setRateStr] = useState(rate > 0 ? String(rate) : "");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sales-sheet" role="dialog" aria-label="판매 셀">
        <div className="grab" />
        <div className="mh">
          <h2>
            {typeLabel(t)} · {dayLabel(date)}
          </h2>
          <span className="muted sm">
            숙박일 · 예약 {booked} / 재고 {remaining} · 총 {total}실
          </span>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        {!readOnly ? (
          <div className="fld">
            <label>기본 1박 요금</label>
            <PriceRow>
              <PriceInp sm>
                <input
                  ref={inputRef}
                  className="num"
                  inputMode="numeric"
                  aria-label="1박 요금"
                  value={rateStr !== "" ? won(Number(rateStr) || 0) : ""}
                  placeholder="금액"
                  disabled={busy}
                  onChange={(e) => setRateStr(e.target.value.replace(/\D/g, "").slice(0, 9))}
                />
              </PriceInp>
              <button
                type="button"
                className="btn sm red"
                disabled={busy}
                onClick={() => void onSaveRate(rateStr ? Number(rateStr) : null)}
              >
                저장
              </button>
              {override != null ? (
                <button type="button" className="chip sm" disabled={busy} onClick={() => void onSaveRate(null)}>
                  기본값으로
                </button>
              ) : null}
            </PriceRow>
            <p className="muted sm">날짜 오버라이드예요. 비우면 평일·주말 기본을 써요.</p>
          </div>
        ) : (
          <div className="fld">
            <label>기본 1박 요금</label>
            <div className="muted">{rate > 0 ? `${won(rate)}원` : "미정"}</div>
          </div>
        )}

        {!readOnly ? (
          <div className="fld">
            <label>판매</label>
            <ChipGroup>
              <Chip tone="sell" active={!stopped} disabled={busy} onClick={() => stopped && void onToggleStop(false)}>
                판매 중
              </Chip>
              <Chip
                tone="stop"
                active={stopped}
                disabled={busy}
                onClick={() => !stopped && void onToggleStop(true)}
                title="이 타입·숙박일은 신규 판매를 막아요"
              >
                <Ban size={14} strokeWidth={2.2} />
                판매중지
              </Chip>
            </ChipGroup>
          </div>
        ) : null}

        <div className="actrow">
          <button type="button" className="btn line" onClick={onClose}>
            닫기
          </button>
          {!readOnly ? (
            <button type="button" className="btn red" disabled={busy || stopped} onClick={onBook}>
              <CalendarPlus size={16} strokeWidth={2.2} />
              간단 예약
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function TypeRateSheet({
  s,
  typeId,
  readOnly,
  busy,
  onClose,
  onSave,
}: {
  s: HotelSettings;
  typeId: string;
  readOnly: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (wd: number | null, we: number | null, flat: number | null) => Promise<void>;
}) {
  const t = s.types.find((x) => x.id === typeId);
  const d = typeRateDefaults(s, typeId);
  const [wd, setWd] = useState(d.weekday != null && d.weekday > 0 ? String(d.weekday) : "");
  const [we, setWe] = useState(d.weekend != null && d.weekend > 0 ? String(d.weekend) : "");
  const [flat, setFlat] = useState(d.flat != null && d.flat > 0 ? String(d.flat) : "");

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal sales-sheet" role="dialog" aria-label="타입 기본 요금">
        <div className="grab" />
        <div className="mh">
          <h2>{typeLabel(t)} 기본 요금</h2>
          <span className="muted sm">평일 · 주말(금·토·특별일) · 공통</span>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>
        {readOnly ? (
          <p className="muted">보기 전용</p>
        ) : (
          <>
            <div className="fld">
              <label>평일</label>
              <PriceInp sm>
                <input
                  className="num"
                  inputMode="numeric"
                  value={wd !== "" ? won(Number(wd) || 0) : ""}
                  placeholder="평일"
                  onChange={(e) => setWd(e.target.value.replace(/\D/g, "").slice(0, 9))}
                />
              </PriceInp>
            </div>
            <div className="fld">
              <label>주말</label>
              <PriceInp sm>
                <input
                  className="num"
                  inputMode="numeric"
                  value={we !== "" ? won(Number(we) || 0) : ""}
                  placeholder="주말"
                  onChange={(e) => setWe(e.target.value.replace(/\D/g, "").slice(0, 9))}
                />
              </PriceInp>
            </div>
            <div className="fld">
              <label>공통(평·주 없을 때)</label>
              <PriceInp sm>
                <input
                  className="num"
                  inputMode="numeric"
                  value={flat !== "" ? won(Number(flat) || 0) : ""}
                  placeholder="기본"
                  onChange={(e) => setFlat(e.target.value.replace(/\D/g, "").slice(0, 9))}
                />
              </PriceInp>
            </div>
            <div className="actrow">
              <button type="button" className="btn line" onClick={onClose}>
                취소
              </button>
              <button
                type="button"
                className="btn red"
                disabled={busy}
                onClick={() => void onSave(wd ? Number(wd) : null, we ? Number(we) : null, flat ? Number(flat) : null)}
              >
                저장
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
