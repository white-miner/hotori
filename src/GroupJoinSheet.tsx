import { joinSummary } from "../shared/changes";
import { useMemo, useState } from "react";
import { saveFailMessage } from "../shared/errors";
import { addDays, allRooms, daysBetween, dayLabel, md, stayEnd, STAY_NIGHTS_MAX, typeLabel, won, type Booking } from "../shared/ledger";
import { freeForStay, groupDrafts, validateGroupAttach } from "../shared/group";
import { roomNightRate } from "../shared/extend";
import { typeGuests } from "../shared/surcharge";
import type { HotelData } from "./data";
import { Chip, ChipGroup, PriceInp, Stepper } from "./primitives";
import { lookups } from "./ui";

/**
 * 객실 추가 — 이미 머무는 단체에 방을 더해요. 입실일·박수·객실별 1박 요금을 자유롭게:
 * 기본값은 「오늘 입실 · 단체가 끝나는 날까지 · 같은 타입 요금」이고, 방마다 요금을 따로 적을 수 있어요.
 * 새 객실은 입실일부터 자기 요금으로만 계산되고, 다음 결제 등록에 자동으로 들어가요.
 */
export default function GroupJoinSheet({
  data,
  today,
  members,
  onClose,
  onSaved,
}: {
  data: HotelData;
  today: string;
  /** 단체 예약 전부 (퇴실한 객실 포함) */
  members: Booking[];
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const first = members[0]!;
  const groupId = first.groupId!;
  const groupName = first.groupName ?? first.guestName;
  const info = data.groups.get(groupId);
  const live = members.filter((m) => m.status === "active" && m.kind === "stay");
  const groupEnd = live.reduce<string | null>((e, m) => {
    const x = stayEnd(m);
    return !e || x > e ? x : e;
  }, null);

  const [checkIn, setCheckIn] = useState(today);
  const defNights = groupEnd && groupEnd > today ? Math.min(STAY_NIGHTS_MAX, daysBetween(today, groupEnd)) : 1;
  const [nights, setNights] = useState(defNights);
  const [picked, setPicked] = useState<string[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [arrived, setArrived] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rooms = allRooms(s);
  const free = useMemo(() => freeForStay(s, data.bookings, checkIn, nights), [s, data.bookings, checkIn, nights]);
  const rmap = new Map(rooms.map((r) => [r.id, r]));
  const suggestRate = (roomId: string): number => {
    const tid = rmap.get(roomId)?.typeId ?? "";
    const typeRate = (info?.rates as Record<string, number> | undefined)?.[tid];
    const peer = live.find((m) => m.typeId === tid) ?? live[0];
    return peer ? roomNightRate(peer, typeRate ?? null) : typeRate ?? 0;
  };
  const rateOf = (id: string) => (rates[id] != null ? Number(rates[id] || 0) : suggestRate(id));
  const toggle = (id: string) => {
    setErr(null);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  };
  const out = addDays(checkIn, nights);
  const sum = picked.reduce((n, id) => n + rateOf(id) * nights, 0);
  const dates = [today, addDays(today, 1), addDays(today, 2)];

  const save = async () => {
    if (busy) return;
    const prices = picked.map((id) => rateOf(id) * nights);
    const v = validateGroupAttach({ nights, roomIds: picked, prices, free });
    if (v) return setErr(v);
    if (picked.some((id) => rateOf(id) <= 0)) return setErr("객실마다 1박 요금을 적어 주세요.");
    setBusy(true);
    setErr(null);
    try {
      const list = groupDrafts({
        groupId,
        groupName,
        platformId: first.platformId,
        checkIn,
        nights,
        roomIds: picked,
        prices,
        memberRates: picked.map(rateOf),
        s,
        guestsOf: (tid) => typeGuests(L.types.get(tid)).base,
        arrived: arrived && checkIn <= today,
      });
      await data.saveGroup(list);
      for (const id of picked) {
        void data.logChange({ kind: "room", groupId, effectiveOn: checkIn, summary: joinSummary({ roomNo: L.roomLabel(id) ?? "?", checkIn, nights, rate: rateOf(id) }) });
      }
      onSaved(`${groupName}에 ${picked.map((id) => L.roomLabel(id) + "호").join(", ")} 추가 · ${md(checkIn)}부터 ${nights}박`);
    } catch (e) {
      setErr(saveFailMessage(e, "객실을 추가하지 못했어요"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="modal assign-type-modal gpp-modal gjn-modal" role="dialog" aria-label="객실 추가" onMouseDown={(e) => e.stopPropagation()}>
        <div className="grab" />
        <div className="mh">
          <h2>객실 추가</h2>
          <span className="muted sm gpp-gname">{groupName}</span>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onClose}>닫기</button>
        </div>
        <div className="mb">
          <div className="gpp-hero">
            <span className="gpp-hl">
              {picked.length ? `${picked.length}객실 · ${md(checkIn)}부터 ${nights}박` : "추가할 객실을 골라 주세요"}
            </span>
            <span className="muted sm">
              {picked.length ? `퇴실 ${md(out)} · 합계 ${won(sum)}원 · 다음 결제 등록에 자동으로 들어가요` : groupEnd ? `단체는 ${md(groupEnd)}까지 예정이에요` : ""}
            </span>
          </div>

          <ChipGroup role="group" aria-label="입실일">
            {dates.map((d, i) => (
              <Chip key={d} active={checkIn === d} onClick={() => setCheckIn(d)}>
                {["오늘", "내일", "모레"][i]} {dayLabel(d)}
              </Chip>
            ))}
            <label className={`chip datechip${dates.includes(checkIn) ? "" : " on"}`}>
              <span>{dates.includes(checkIn) ? "날짜 고르기" : dayLabel(checkIn)}</span>
              <input type="date" min="2020-01-01" max="2099-12-31" value={checkIn} onChange={(e) => e.target.value && setCheckIn(e.target.value)} aria-label="입실일" />
            </label>
          </ChipGroup>

          <Stepper value={nights} unit="박" min={1} max={STAY_NIGHTS_MAX} onChange={(n) => setNights(Math.max(1, Math.min(STAY_NIGHTS_MAX, n)))} />

          <div className="gjn-rooms" role="group" aria-label="객실 선택">
            {rooms.map((r) => {
              const ok = free.has(r.id);
              const on = picked.includes(r.id);
              return (
                <button key={r.id} type="button" className={`chip sm${on ? " on" : ""}`} disabled={!ok && !on} aria-pressed={on} onClick={() => toggle(r.id)} title={ok ? "" : "그 기간에 다른 예약이 있어요"}>
                  {L.roomLabel(r.id)}
                </button>
              );
            })}
          </div>

          {picked.length ? (
            <ul className="gpp-rows" aria-label="객실별 1박 요금">
              {picked.map((id) => (
                <li key={id} className="gpp-row">
                  <span className="gpp-no"><b>{L.roomLabel(id)}호</b><small className="muted">{typeLabel(L.types.get(rmap.get(id)?.typeId ?? ""))}</small></span>
                  <span className="gpp-amt">
                    <PriceInp sm>
                      <span className="pl">1박</span>
                      <input
                        className="num"
                        inputMode="numeric"
                        aria-label={`${L.roomLabel(id)}호 1박 요금`}
                        value={won(rateOf(id)) === "0" ? "" : won(rateOf(id))}
                        placeholder="0"
                        onChange={(e) => setRates((m) => ({ ...m, [id]: e.target.value.replace(/\D/g, "").slice(0, 9) }))}
                      />
                    </PriceInp>
                  </span>
                  <span className="gpp-st muted sm">{nights}박 × {won(rateOf(id))} = {won(rateOf(id) * nights)}원</span>
                </li>
              ))}
            </ul>
          ) : null}

          {checkIn <= today ? (
            <label className="gjn-arr">
              <input type="checkbox" checked={arrived} onChange={(e) => setArrived(e.target.checked)} /> 바로 입실 처리
            </label>
          ) : null}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts gpp-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onClose}>취소</button>
          <button type="button" className="btn dark gpp-go" disabled={busy || !picked.length} onClick={() => void save()}>
            {busy ? "저장 중…" : picked.length ? `${picked.length}객실 추가` : "객실을 골라 주세요"}
          </button>
        </div>
      </div>
    </div>
  );
}
