// 설정 › 객실 요금: 주말 요일 · 타입별 평일/주말/기본 요금 · 시즌(성수기 등) 요금
import { useEffect, useState } from "react";
import { CalendarRange, ChevronDown, Copy, Plus, Trash2 } from "lucide-react";
import { type HotelSettings, md, typeLabel, usableTypes, weekday } from "../shared/ledger";
import {
  DOW_KO,
  RATE_MAX,
  type RateSeason,
  SEASON_NAME_MAX,
  SEASONS_PER_TYPE_MAX,
  copySeasonTo,
  normalizeWeekendDays,
  upsertSeason,
  validateSeason,
  weekendDaysText,
} from "../shared/seasonRates";
import { setTypeRateDefaults } from "../shared/salesCalendar";
import { shortWon } from "../shared/surcharge";
import { uid } from "./ui";
import NumInput from "./NumInput";

type Upd = (fn: (x: HotelSettings) => HotelSettings) => void;

const span = (a: string, b: string) => {
  const n = Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;
  return `${md(a)}(${weekday(a)}) ~ ${md(b)}(${weekday(b)}) · ${n}일`;
};

function SeasonRow({
  value,
  siblings,
  draft,
  otherTypes,
  onValid,
  onRemove,
  onCopy,
}: {
  value: RateSeason;
  siblings: RateSeason[];
  draft: boolean;
  otherTypes: { id: string; name: string }[];
  onValid: (s: RateSeason) => void;
  onRemove: () => void;
  onCopy: (s: RateSeason, targets: string[]) => string;
}) {
  const [d, setD] = useState<RateSeason>(value);
  const [touched, setTouched] = useState(!draft);
  const [copyOpen, setCopyOpen] = useState(false);
  const [targets, setTargets] = useState<string[]>([]);
  const [copyMsg, setCopyMsg] = useState("");
  const err = validateSeason(d, siblings);
  const changed = d.name !== value.name || d.from !== value.from || d.to !== value.to || d.weekday !== value.weekday || d.weekend !== value.weekend;
  useEffect(() => {
    if (!err && (changed || draft)) onValid(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d]);
  const patch = (p: Partial<RateSeason>) => {
    setTouched(true);
    setD((x) => ({ ...x, ...p }));
  };
  return (
    <div className={`rs-season ${err && touched ? "bad" : ""}`}>
      <div className="rs-srow">
        <input
          className="nin rs-sname"
          value={d.name}
          maxLength={SEASON_NAME_MAX}
          placeholder="시즌 이름 (예: 성수기)"
          aria-label="시즌 이름"
          autoFocus={draft}
          onChange={(e) => patch({ name: e.target.value.slice(0, SEASON_NAME_MAX) })}
        />
        <button className="ic" aria-label="시즌 지우기" onClick={onRemove}>
          <Trash2 size={14} />
        </button>
      </div>
      <div className="rs-dates">
        <label>
          <span>시작</span>
          <input type="date" value={d.from} aria-label="시즌 시작일" onChange={(e) => patch({ from: e.target.value })} />
        </label>
        <i aria-hidden>~</i>
        <label>
          <span>끝 (그날 밤까지)</span>
          <input type="date" value={d.to} min={d.from || undefined} aria-label="시즌 끝나는 날" onChange={(e) => patch({ to: e.target.value })} />
        </label>
      </div>
      <div className="rs-rates">
        <label className="tierin">
          <span>평일</span>
          <NumInput aria-label={`${d.name || "시즌"} 평일 요금`} min={0} max={RATE_MAX} allowEmpty value={d.weekday || null} onChange={(v) => patch({ weekday: v && v > 0 ? v : null })} />원
        </label>
        <label className="tierin">
          <span>주말</span>
          <NumInput aria-label={`${d.name || "시즌"} 주말 요금`} min={0} max={RATE_MAX} allowEmpty value={d.weekend || null} placeholder="평일과 같음" onChange={(v) => patch({ weekend: v && v > 0 ? v : null })} />원
        </label>
      </div>
      {err && touched ? (
        <div className="rs-err" role="alert">
          {err}
          {!draft ? " · 고칠 때까지 이전 값이 그대로 쓰여요" : " · 다 채우면 저장돼요"}
        </div>
      ) : d.from && d.to && d.from <= d.to ? (
        <div className="muted sm">{span(d.from, d.to)}</div>
      ) : null}
      {!draft && !err && otherTypes.length ? (
        <div className="rs-copy">
          <button className="btn sm ghost" aria-expanded={copyOpen} onClick={() => setCopyOpen((o) => !o)}>
            <Copy size={12} /> 다른 타입에도 적용
          </button>
          {copyOpen ? (
            <div className="rs-copybox">
              <div className="rs-chips">
                {otherTypes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`rs-chip ${targets.includes(t.id) ? "on" : ""}`}
                    aria-pressed={targets.includes(t.id)}
                    onClick={() => setTargets((c) => (c.includes(t.id) ? c.filter((x) => x !== t.id) : [...c, t.id]))}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
              <button
                className="btn sm"
                disabled={!targets.length}
                onClick={() => {
                  setCopyMsg(onCopy(d, targets));
                  setTargets([]);
                }}
              >
                복사하기
              </button>
              {copyMsg ? <div className="muted sm">{copyMsg}</div> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function WeekendDaysSettings({ s, update, notify }: { s: HotelSettings; update: Upd; notify: (m: string) => void }) {
  const days = normalizeWeekendDays(s.weekendDays);
  const toggle = (i: number) => {
    const on = days.includes(i);
    if (on && days.length <= 1) return notify("주말 요일은 하나 이상 있어야 해요 (주말 요금을 안 쓰면 주말 칸을 비워 두세요)");
    update((x) => ({ ...x, weekendDays: normalizeWeekendDays(on ? days.filter((d) => d !== i) : [...days, i]) }));
  };
  return (
    <div className="rs-weekend">
      <div className="rs-label">주말 요금을 받는 밤</div>
      <div className="rs-days" role="group" aria-label="주말 요일">
        {[...DOW_KO].map((w, i) => (
          <button key={w} type="button" className={`rs-day ${days.includes(i) ? "on" : ""}`} aria-pressed={days.includes(i)} onClick={() => toggle(i)}>
            {w}
          </button>
        ))}
      </div>
      <div className="muted sm">
        지금은 <b>{weekendDaysText(days)}</b>요일 밤이 주말이에요. ‘금요일 밤’은 금요일에 자고 토요일에 나가는 숙박이에요. 특별일로 켠 날도 주말 요금이고, 인원 추가 요금도 같은 기준이에요.
      </div>
    </div>
  );
}

export function RateSettings({ s, update, notify }: { s: HotelSettings; update: Upd; notify: (m: string) => void }) {
  const types = usableTypes(s.types);
  const [open, setOpen] = useState<string[]>(() => types.slice(0, 1).map((t) => t.id));
  const [drafts, setDrafts] = useState<Record<string, RateSeason[]>>({});
  const hasAny = types.some((t) => {
    const r = s.typeRates?.[t.id];
    return !!(r && (r.weekday || r.weekend || r.flat));
  });
  const setRate = (id: string, key: "weekday" | "weekend" | "flat", v: number | null) => {
    update((x) => {
      const cur = x.typeRates?.[id] ?? { weekday: null, weekend: null, flat: null };
      return setTypeRateDefaults(x, id, { ...cur, [key]: v && v > 0 ? v : null });
    });
  };
  const saveSeason = (typeId: string, next: RateSeason) => {
    const r = upsertSeason(s.typeSeasons[typeId] ?? [], next);
    if (r.error) return notify(r.error);
    update((x) => {
      const rr = upsertSeason(x.typeSeasons[typeId] ?? [], next);
      return rr.error ? x : { ...x, typeSeasons: { ...x.typeSeasons, [typeId]: rr.list } };
    });
    setDrafts((d) => ({ ...d, [typeId]: (d[typeId] ?? []).filter((z) => z.id !== next.id) }));
  };
  const removeSeason = (typeId: string, id: string) => {
    setDrafts((d) => ({ ...d, [typeId]: (d[typeId] ?? []).filter((z) => z.id !== id) }));
    update((x) => {
      const list = (x.typeSeasons[typeId] ?? []).filter((z) => z.id !== id);
      const m = { ...x.typeSeasons };
      if (list.length) m[typeId] = list;
      else delete m[typeId];
      return { ...x, typeSeasons: m };
    });
  };
  const copy = (season: RateSeason, targets: string[]): string => {
    const r = copySeasonTo(s.typeSeasons, season, targets, () => uid("z"));
    if (r.copied.length) update((x) => ({ ...x, typeSeasons: copySeasonTo(x.typeSeasons, season, r.copied, () => uid("z")).map }));
    const nameOf = (id: string) => typeLabel(s.types.find((t) => t.id === id)) || id;
    const parts: string[] = [];
    if (r.copied.length) parts.push(`${r.copied.map(nameOf).join(", ")}에 복사했어요`);
    for (const k of r.skipped) parts.push(`${nameOf(k.typeId)}: ${k.reason}`);
    return parts.join(" · ");
  };
  if (!types.length) return <div className="muted sm">객실 타입을 먼저 만들어 주세요.</div>;
  return (
    <>
      <ol className="rs-prec" aria-label="요금 우선순위">
        <li><b>1</b> 특별일 요금<small>판매 캘린더에서 날짜별로 정한 금액</small></li>
        <li><b>2</b> 시즌<small>성수기 등 기간 요금</small></li>
        <li><b>3</b> 평일 / 주말<small>요일별 기본 요금</small></li>
        <li><b>4</b> 기본<small>평일·주말이 비었을 때</small></li>
      </ol>
      <WeekendDaysSettings s={s} update={update} notify={notify} />
      {!hasAny ? (
        <div className="rs-hint" role="status">
          아직 요금이 없어요. 평일·주말 요금을 적으면 간단 예약에서 박마다 계산해 채워 줘요. 비워 두면 지금처럼 직접 적으면 돼요.
        </div>
      ) : null}
      {types.map((t) => {
        const r = s.typeRates?.[t.id];
        const seasons = s.typeSeasons[t.id] ?? [];
        const ds = drafts[t.id] ?? [];
        const isOpen = open.includes(t.id);
        const sum = [r?.weekday ? `평일 ${shortWon(r.weekday)}` : "", r?.weekend ? `주말 ${shortWon(r.weekend)}` : "", !r?.weekday && !r?.weekend && r?.flat ? `기본 ${shortWon(r.flat)}` : "", seasons.length ? `시즌 ${seasons.length}` : ""].filter(Boolean).join(" · ");
        return (
          <div className="rs-type" key={t.id}>
            <button className="rs-thead" aria-expanded={isOpen} onClick={() => setOpen((o) => (isOpen ? o.filter((x) => x !== t.id) : [...o, t.id]))}>
              <b>{typeLabel(t)}</b>
              <span className={`rs-sum ${sum ? "" : "none"}`}>{sum || "요금 없음"}</span>
              <ChevronDown size={15} className={isOpen ? "up" : ""} />
            </button>
            {isOpen ? (
              <div className="rs-body">
                <div className="rs-rates three">
                  <label className="tierin">
                    <span>평일</span>
                    <NumInput aria-label={`${typeLabel(t)} 평일 요금`} min={0} max={RATE_MAX} allowEmpty value={r?.weekday || null} onChange={(v) => setRate(t.id, "weekday", v)} />원
                  </label>
                  <label className="tierin">
                    <span>주말</span>
                    <NumInput aria-label={`${typeLabel(t)} 주말 요금`} min={0} max={RATE_MAX} allowEmpty value={r?.weekend || null} onChange={(v) => setRate(t.id, "weekend", v)} />원
                  </label>
                  <label className="tierin">
                    <span>기본</span>
                    <NumInput aria-label={`${typeLabel(t)} 기본 요금`} min={0} max={RATE_MAX} allowEmpty value={r?.flat || null} onChange={(v) => setRate(t.id, "flat", v)} />원
                  </label>
                </div>
                <div className="rs-sh">
                  <CalendarRange size={13} /> 시즌 요금 <small>기간 안에서는 위 평일/주말 요금 대신 써요 · 기간이 겹치면 안 돼요</small>
                </div>
                {seasons.map((z) => (
                  <SeasonRow
                    key={z.id}
                    value={z}
                    draft={false}
                    siblings={seasons.filter((o) => o.id !== z.id)}
                    otherTypes={types.filter((o) => o.id !== t.id).map((o) => ({ id: o.id, name: typeLabel(o) }))}
                    onValid={(n) => saveSeason(t.id, n)}
                    onRemove={() => removeSeason(t.id, z.id)}
                    onCopy={copy}
                  />
                ))}
                {ds.map((z) => (
                  <SeasonRow
                    key={z.id}
                    value={z}
                    draft
                    siblings={seasons}
                    otherTypes={[]}
                    onValid={(n) => saveSeason(t.id, n)}
                    onRemove={() => setDrafts((d) => ({ ...d, [t.id]: (d[t.id] ?? []).filter((x) => x.id !== z.id) }))}
                    onCopy={() => ""}
                  />
                ))}
                <button
                  className="add"
                  onClick={() => {
                    if (seasons.length + ds.length >= SEASONS_PER_TYPE_MAX) return notify(`시즌은 타입마다 최대 ${SEASONS_PER_TYPE_MAX}개까지예요`);
                    setDrafts((d) => ({ ...d, [t.id]: [...(d[t.id] ?? []), { id: uid("z"), name: "", from: "", to: "", weekday: null, weekend: null }] }));
                  }}
                >
                  <Plus size={14} />
                  시즌 추가
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
