import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  KeyRound,
  LogOut,
  Plus,
  Sparkles,
  User,
  Wrench,
  X,
} from "lucide-react";
import type { PaymentMethod, Reservation, Room } from "../../shared/types";
import {
  addDays,
  arrivalAt,
  channelName,
  cleaningLabels,
  type CommandFn,
  type Ctx,
  departureAt,
  facilityLabels,
  fmtLeft,
  hm,
  hourOf,
  isHourly,
  kindOf,
  paymentLabels,
  type RoomView,
  shortDate,
  stayNights,
  wonSign,
} from "../lib";
import { canCheckInNow } from "../views/BuildingView";
import { Chips, ColorPicker } from "./ui";

type Mode = "hourly" | "nightly" | "multi";
export interface PanelState {
  roomId?: string;
  mode?: Mode;
  startMs?: number;
  tab?: "guest" | "room";
}

export function RoomPanel({
  ctx,
  views,
  panel,
  setPanel,
  busy,
  error,
  command,
  onClose,
  onOpenReservation,
  sheet,
}: {
  ctx: Ctx;
  views: Map<string, RoomView>;
  panel: PanelState;
  setPanel: (p: PanelState) => void;
  busy: boolean;
  error: string;
  command: CommandFn;
  onClose: () => void;
  onOpenReservation: (r: Reservation) => void;
  sheet: boolean;
}) {
  const { s } = ctx;
  const v = panel.roomId ? views.get(panel.roomId) : undefined;
  const tab = panel.tab || "guest";
  const vacantRooms = [...views.values()].filter((x) => x.status === "vac");
  if (!v) {
    return (
      <div className="panel-inner">
        <div className="p-h">
          <div className="row">
            <div>
              <h2>빈 방에 바로 넣기</h2>
              <p className="p-sub">
                지금 비어 있는 방 {vacantRooms.length}개 · {hm(ctx.now)} 기준
              </p>
            </div>
            <button
              type="button"
              className="icb"
              aria-label="닫기"
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>
        </div>
        <div className="p-b">
          {vacantRooms.length ? (
            <div className="rooms">
              {vacantRooms.map((x) => (
                <button
                  type="button"
                  key={x.room.id}
                  className="rpk"
                  onClick={() => setPanel({ ...panel, roomId: x.room.id })}
                >
                  <b className="num">{x.room.number}</b>
                  <span>{x.room.label || x.typeName}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="quiet">
              지금 바로 팔 수 있는 빈 방이 없어요. 청소가 끝나면 여기에 나와요.
            </p>
          )}
        </div>
      </div>
    );
  }
  const room = v.room;
  const floorKey = `${room.building}|${room.floor}`;
  const metaText =
    v.status === "vac"
      ? v.next
        ? `다음 예약 ${hm(arrivalAt(s, v.next))} ${v.next.guestName} 님`
        : "청소 끝 · 다음 예약 없음"
      : v.status === "use" && v.stay
        ? `${v.stay.guestName} 님 · ${isHourly(v.stay) ? `${hm(v.stay.endAt!)} 퇴실` : `${shortDate(v.stay.checkOut)} ${s.settings.checkOutTime} 퇴실`}`
        : v.status === "rsv" && v.next
          ? `${hm(arrivalAt(s, v.next))} 도착 예정 · ${v.next.guestName} 님`
          : v.status === "cln"
            ? room.cleaning === "cleaning"
              ? "청소하고 있어요"
              : "청소를 기다리고 있어요"
            : facilityLabels[room.facility];
  return (
    <div className="panel-inner">
      <div className="p-h">
        <div className="row">
          <h2 className="num">
            {room.number}호
            <small>
              {v.typeName} · {room.floor}층
            </small>
          </h2>
          <button
            type="button"
            className="icb"
            aria-label="닫기"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </div>
        <div className="meta">
          <span
            className={`chip ${{ use: "k", rsv: "r", vac: "v", cln: "c", chk: "x" }[v.status]}`}
          >
            {
              {
                use: v.kind || "사용중",
                rsv: "예약",
                vac: "빈방",
                cln: "청소",
                chk: "점검",
              }[v.status]
            }
          </span>
          {room.label && (
            <span
              className="rtag big"
              style={{ ["--rcol" as string]: room.color || "var(--ai)" }}
            >
              {room.label}
            </span>
          )}
          <span>{metaText}</span>
        </div>
        <div className="p-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "guest"}
            className={tab === "guest" ? "on" : ""}
            onClick={() => setPanel({ ...panel, tab: "guest" })}
          >
            손님
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "room"}
            className={tab === "room" ? "on" : ""}
            onClick={() => setPanel({ ...panel, tab: "room" })}
          >
            객실 상태 · 색
          </button>
        </div>
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {tab === "room" ? (
        <RoomStateTab
          ctx={ctx}
          room={room}
          floorKey={floorKey}
          busy={busy}
          command={command}
        />
      ) : v.status === "vac" ? (
        <CheckInForm
          key={room.id + (panel.startMs || "") + (panel.mode || "")}
          ctx={ctx}
          v={v}
          panel={panel}
          busy={busy}
          command={command}
          sheet={sheet}
          onOpenReservation={onOpenReservation}
        />
      ) : (
        <StatusBody
          ctx={ctx}
          v={v}
          busy={busy}
          command={command}
          onOpenReservation={onOpenReservation}
        />
      )}
    </div>
  );
}

function StatusBody({
  ctx,
  v,
  busy,
  command,
  onOpenReservation,
}: {
  ctx: Ctx;
  v: RoomView;
  busy: boolean;
  command: CommandFn;
  onOpenReservation: (r: Reservation) => void;
}) {
  const { s, now } = ctx;
  const { room, stay, next } = v;
  const r = stay || next;
  const info = (x: Reservation) => (
    <div className="guest-card">
      <div className="gc-row">
        <span className="gc-avatar">
          <User size={16} />
        </span>
        <div>
          <b>{x.guestName} 님</b>
          <span>
            {kindOf(x)} · {channelName(s, x.channelId)}
            {x.phone ? ` · ${x.phone}` : ""}
          </span>
        </div>
      </div>
      <div className="timebox">
        <div>
          <div className="tt num">
            {isHourly(x) ? hm(x.startAt!) : shortDate(x.checkIn)}
          </div>
          <div className="tn">
            {x.status === "checked_in" ? "들어왔어요" : "도착 예정"}
            {!isHourly(x) && ` ${s.settings.checkInTime}`}
          </div>
        </div>
        <div className="ar">
          <ArrowRight size={20} />
        </div>
        <div>
          <div className="tt num warm">
            {isHourly(x) ? hm(x.endAt!) : shortDate(x.checkOut)}
          </div>
          <div className="tn">
            퇴실{!isHourly(x) && ` ${s.settings.checkOutTime}`} ·{" "}
            {isHourly(x) ? `대실 ${x.hours}시간` : `${stayNights(x)}박`}
          </div>
        </div>
      </div>
      {x.status === "checked_in" && isHourly(x) && (
        <div className="left-line">
          <b className={v.alert ? "warm" : ""}>
            {(v.leftMin || 0) >= 0
              ? `${fmtLeft(v.leftMin || 0)} 남음`
              : `${fmtLeft(-(v.leftMin || 0))} 지남`}
          </b>
          <div className="bar">
            <i
              style={{
                width: `${Math.min(100, Math.max(0, (1 - (v.leftMin || 0) / (v.totalMin || 1)) * 100))}%`,
              }}
            />
          </div>
        </div>
      )}
      <div className="sum small">
        <span>
          {isHourly(x) ? "대실 요금" : "숙박 요금"}
          {x.payment ? ` · ${paymentLabels[x.payment]}` : ""}
        </span>
        <b className="num">{wonSign(x.totalAmount)}</b>
      </div>
      <button
        type="button"
        className="text-button"
        onClick={() => onOpenReservation(x)}
      >
        예약 자세히 보기 <ArrowRight size={14} />
      </button>
    </div>
  );
  return (
    <>
      <div className="p-b">
        {r && info(r)}
        {v.status === "cln" && (
          <div className="hint">
            <Sparkles size={14} />
            {room.cleaning === "dirty"
              ? `청소를 기다리는 중이에요${room.cleaningSince ? ` · ${fmtLeft((now - Date.parse(room.cleaningSince)) / 60000)}째` : ""}`
              : `청소 중 · ${room.cleaningSince ? hm(Date.parse(room.cleaningSince) + s.settings.cleaningMinutes * 60000) + "쯤 끝나요" : "끝나면 눌러 주세요"}`}
          </div>
        )}
        {v.status === "chk" && (
          <div className="hint gray">
            <Wrench size={14} />
            {v.issues.length
              ? v.issues.map((i) => i.title).join(", ")
              : "점검·판매 중지 상태예요"}
          </div>
        )}
      </div>
      <div className="p-f">
        {v.status === "use" && stay && (
          <button
            type="button"
            className="cta"
            disabled={busy || !v.canCheckout}
            onClick={() =>
              void command(
                "reservation.checkout",
                { id: stay.id, version: stay.version },
                { undoLabel: `${room.number}호 퇴실 처리했어요` },
              )
            }
          >
            <LogOut size={18} />
            {v.canCheckout
              ? `${room.number}호 퇴실 처리`
              : `퇴실일(${shortDate(stay.checkOut)})에 퇴실 처리`}
          </button>
        )}
        {v.status === "rsv" && next && (
          <button
            type="button"
            className="cta"
            disabled={busy || !canCheckInNow(ctx, next)}
            onClick={() =>
              void command(
                "reservation.checkin",
                { id: next.id, version: next.version },
                { undoLabel: `${room.number}호 체크인했어요` },
              )
            }
          >
            <KeyRound size={18} />
            {canCheckInNow(ctx, next)
              ? `${room.number}호 ${next.guestName} 님 체크인`
              : `${hm(arrivalAt(s, next))} 도착 예정`}
          </button>
        )}
        {v.status === "cln" && (
          <button
            type="button"
            className={`cta ${room.cleaning === "cleaning" ? "teal" : ""}`}
            disabled={busy}
            onClick={() =>
              void command(
                "room.update",
                {
                  id: room.id,
                  version: room.version,
                  cleaning: room.cleaning === "dirty" ? "cleaning" : "clean",
                },
                {
                  undoLabel:
                    room.cleaning === "dirty"
                      ? `${room.number}호 청소 시작`
                      : `${room.number}호 청소 끝`,
                },
              )
            }
          >
            <Sparkles size={18} />
            {room.cleaning === "dirty" ? "청소 시작" : "청소 끝났어요"}
          </button>
        )}
        {v.status === "chk" && (
          <button
            type="button"
            className="cta solid"
            disabled={busy}
            onClick={() =>
              void command(
                "room.update",
                { id: room.id, version: room.version, facility: "normal" },
                { undoLabel: `${room.number}호 판매 재개` },
              )
            }
          >
            <Check size={18} />
            점검 끝 · 판매 재개
          </button>
        )}
      </div>
    </>
  );
}

const HOUR_CHOICES = [2, 3, 4, 6];
const NIGHT_CHOICES = [2, 3, 4, 5, 7];
function CheckInForm({
  ctx,
  v,
  panel,
  busy,
  command,
  sheet,
  onOpenReservation,
}: {
  ctx: Ctx;
  v: RoomView;
  panel: PanelState;
  busy: boolean;
  command: CommandFn;
  sheet: boolean;
  onOpenReservation: (r: Reservation) => void;
}) {
  const { s, now, bd } = ctx;
  const room = v.room;
  const type = s.roomTypes.find((t) => t.id === room.typeId)!;
  const o = s.settings;
  const [mode, setMode] = useState<Mode>(panel.mode || "hourly");
  const [hours, setHours] = useState<number>(o.baseHours);
  const [customHours, setCustomHours] = useState(false);
  const [nights, setNights] = useState(2);
  const [guestName, setGuestName] = useState("");
  const [phone, setPhone] = useState("");
  const [channelId, setChannelId] = useState("walkin");
  const [payment, setPayment] = useState<PaymentMethod>("card");
  const [manual, setManual] = useState(false);
  const [amount, setAmount] = useState(0);
  const startMs =
    panel.startMs && panel.startMs > now + 5 * 60000 ? panel.startMs : now;
  const future = startMs > now;
  const n = mode === "multi" ? nights : 1;
  const auto =
    mode === "hourly"
      ? (type.hourlyRate || 0) +
        Math.max(0, hours - o.baseHours) * o.extraHourFee
      : type.baseRate * n;
  useEffect(() => {
    if (!manual) setAmount(auto);
  }, [auto, manual]);
  const price = manual ? amount : auto;
  const checkInDay = s.lateArrivalDate || s.today;
  const endMs =
    mode === "hourly"
      ? startMs + hours * 3600000
      : Date.parse(`${addDays(checkInDay, n)}T${o.checkOutTime}:00+09:00`);
  const waiting = useMemo(
    () =>
      s.reservations.filter(
        (r) =>
          r.status === "confirmed" &&
          !isHourly(r) &&
          r.typeId === room.typeId &&
          r.roomIds.length === 0 &&
          (r.checkIn === s.today || r.checkIn === s.lateArrivalDate) &&
          r.quantity === 1,
      ),
    [s, room.typeId],
  );
  async function submit() {
    if (mode === "hourly") {
      const base = {
        stayType: "hourly",
        roomId: room.id,
        hours,
        guestName: guestName.trim(),
        phone: phone.trim(),
        channelId,
        payment,
        ...(manual ? { amount: price } : {}),
      };
      if (future)
        void command("reservation.create", {
          ...base,
          startAt: new Date(startMs).toISOString(),
        });
      else
        void command("reservation.walkin", base, {
          undoLabel: `${room.number}호 대실 ${hours}시간 체크인했어요`,
        });
    } else {
      void command(
        "reservation.walkin",
        {
          stayType: "nightly",
          roomId: room.id,
          nights: n,
          guestName: guestName.trim(),
          phone: phone.trim(),
          channelId,
          payment,
          nightlyRate: Math.round(price / n),
        },
        { undoLabel: `${room.number}호 ${n}박 체크인했어요` },
      );
    }
  }
  async function assignAndCheckIn(r: Reservation) {
    if (
      await command(
        "reservation.assign",
        { id: r.id, version: r.version, roomIds: [room.id] },
        { close: false },
      )
    )
      await command(
        "reservation.checkin",
        { id: r.id, version: r.version + 1 },
        { undoLabel: `${room.number}호 ${r.guestName} 님 체크인했어요` },
      );
  }
  const mini = () => {
    const sh = hourOf(startMs, bd);
    const ws = Math.max(6, Math.min(Math.floor(sh) - 3, 18)),
      we = ws + 12;
    const pct = (h: number) =>
      `${((Math.min(Math.max(h, ws), we) - ws) / (we - ws)) * 100}%`;
    const eh = sh + hours,
      ch = eh + o.cleaningMinutes / 60;
    const ticks = [];
    for (let h = ws; h <= we; h += 3) ticks.push(h);
    return (
      <div className="mini">
        {ticks.map((h) => (
          <span
            key={h}
            className="tick num"
            style={{ left: `calc(10px + (100% - 20px) * ${(h - ws) / 12})` }}
          >
            {h % 24 === 0 ? "자정" : h % 24}
          </span>
        ))}
        <div className="mini-track">
          <div
            className="blk short"
            style={{
              left: pct(sh),
              width: `calc(${pct(eh)} - ${pct(sh)})`,
              top: 2,
              height: 22,
              ["--hp" as string]: "1px",
            }}
          >
            <span className="bn">새 대실 {hours}시간</span>
          </div>
          <div
            className="blk cln"
            style={{
              left: pct(eh),
              width: `calc(${pct(ch)} - ${pct(eh)})`,
              top: 2,
              height: 22,
            }}
          >
            <Sparkles size={11} strokeWidth={2.4} />
          </div>
          <div className="mini-now" style={{ left: pct(hourOf(now, bd)) }} />
        </div>
        <div className="mini-cap">
          <Sparkles size={10} strokeWidth={2.4} /> 청소 {o.cleaningMinutes}분
          자동 · {hm(ch * 3600000 + Date.parse(`${bd}T00:00:00+09:00`))}부터
          다시 판매 가능
        </div>
      </div>
    );
  };
  const channelChips = s.channels.map((c) => ({ value: c.id, label: c.name }));
  const label =
    mode === "hourly"
      ? `대실 ${hours}시간`
      : mode === "multi"
        ? `연박 ${n}박`
        : "숙박 1박";
  return (
    <>
      <div className="p-b">
        <div>
          <div className="lab">
            <span>어떻게 묵으세요?</span>
          </div>
          <div className="seg" role="radiogroup" aria-label="묵는 방식">
            {(
              [
                ["hourly", "대실", "시간 단위"],
                ["nightly", "숙박", "오늘 밤"],
                ["multi", "연박", "2박 이상"],
              ] as const
            ).map(([m, l, sub]) => (
              <button
                type="button"
                role="radio"
                aria-checked={mode === m}
                key={m}
                className={mode === m ? "on" : ""}
                onClick={() => setMode(m)}
              >
                {l}
                {!sheet && <small>{sub}</small>}
              </button>
            ))}
          </div>
        </div>
        {mode === "hourly" && (
          <div>
            <div className="lab">
              <span>대실 시간</span>
              <span className="lab-note">
                기본 {o.baseHours}시간
                {o.extraHourFee
                  ? ` · 넘으면 1시간 ${wonSign(o.extraHourFee)}`
                  : ""}
              </span>
            </div>
            <div className="chips wrap">
              {HOUR_CHOICES.map((h) => (
                <button
                  type="button"
                  key={h}
                  className={`ch ${!customHours && hours === h ? "on" : ""}`}
                  onClick={() => (setCustomHours(false), setHours(h))}
                >
                  {!customHours && hours === h && (
                    <Check size={13} strokeWidth={2.6} />
                  )}
                  {h}시간
                </button>
              ))}
              {customHours ? (
                <label className="ch on input-ch">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={hours}
                    aria-label="대실 시간 직접 입력"
                    onChange={(e) =>
                      setHours(
                        Math.min(12, Math.max(1, Number(e.target.value) || 1)),
                      )
                    }
                  />
                  시간
                </label>
              ) : (
                <button
                  type="button"
                  className="ch"
                  onClick={() => setCustomHours(true)}
                >
                  직접 입력
                </button>
              )}
            </div>
          </div>
        )}
        {mode === "multi" && (
          <div>
            <div className="lab">
              <span>며칠 묵으세요?</span>
            </div>
            <Chips
              label="숙박일수"
              value={nights}
              onChange={setNights}
              options={NIGHT_CHOICES.map((x) => ({
                value: x,
                label: `${x}박`,
              }))}
            />
          </div>
        )}
        <div className="timebox">
          <div>
            <div className="tt num">{future ? hm(startMs) : hm(now)}</div>
            <div className="tn">{future ? "들어올 예정" : "지금 들어가요"}</div>
          </div>
          <div className="ar">
            <ArrowRight size={20} />
          </div>
          <div>
            <div className="tt num warm">
              {mode === "hourly"
                ? hm(endMs)
                : `${shortDate(addDays(checkInDay, n))} ${o.checkOutTime}`}
            </div>
            <div className="tn">
              퇴실{mode === "hourly" ? " · 알림 10분 전" : ""}
            </div>
          </div>
        </div>
        {mode === "hourly" ? (
          sheet ? (
            <div>
              <div className="lab">
                <span>{room.number}호 오늘 시간표 미리보기</span>
              </div>
              {mini()}
            </div>
          ) : (
            <div className="hint">
              <Sparkles size={14} />
              퇴실하면 청소 {o.cleaningMinutes}분이 자동으로 잡혀요
            </div>
          )
        ) : (
          <div className="hint">
            <Sparkles size={14} />
            퇴실하면 방이 바로 청소 필요 상태가 돼요
          </div>
        )}
        <div>
          <div className="lab">
            <span>손님 이름</span>
            <span className="lab-note">선택</span>
          </div>
          <label className="field">
            <input
              value={guestName}
              maxLength={60}
              placeholder={mode === "hourly" ? "대실 손님" : "현장 손님"}
              onChange={(e) => setGuestName(e.target.value)}
              aria-label="손님 이름"
            />
            <User size={16} />
          </label>
        </div>
        {mode !== "hourly" && (
          <div>
            <div className="lab">
              <span>연락처</span>
              <span className="lab-note">선택</span>
            </div>
            <label className="field">
              <input
                value={phone}
                type="tel"
                maxLength={30}
                placeholder="010-0000-0000"
                onChange={(e) => setPhone(e.target.value)}
                aria-label="연락처"
              />
            </label>
          </div>
        )}
        <div>
          <div className="lab">
            <span>어디서 오셨어요?</span>
          </div>
          <Chips
            label="판매 채널"
            value={channelId}
            onChange={setChannelId}
            options={[
              ...channelChips.filter((c) => c.value === "walkin"),
              ...channelChips.filter((c) => c.value !== "walkin"),
            ]}
          />
        </div>
        <div>
          <div className="lab">
            <span>결제</span>
          </div>
          <Chips
            label="결제"
            value={payment}
            onChange={setPayment}
            options={(Object.keys(paymentLabels) as PaymentMethod[]).map(
              (p) => ({ value: p, label: paymentLabels[p] }),
            )}
          />
        </div>
        {waiting.length > 0 && mode !== "hourly" && (
          <div className="waiting">
            <div className="lab">
              <span>오늘 도착할 {v.typeName} 예약 (방 배정 전)</span>
            </div>
            {waiting.map((r) => (
              <div key={r.id} className="wait-row">
                <div>
                  <b>{r.guestName} 님</b>
                  <span>
                    {stayNights(r)}박 · {channelName(s, r.channelId)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={busy || room.cleaning !== "clean"}
                  onClick={() => void assignAndCheckIn(r)}
                >
                  이 방으로 체크인
                </button>
                <button
                  type="button"
                  className="icb sm"
                  aria-label="예약 보기"
                  onClick={() => onOpenReservation(r)}
                >
                  <ArrowRight size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="p-f">
        <div className="sum">
          <span>
            {label} · {type.name}
            {s.property.demo ? " (예시 요금)" : ""}
            <button
              type="button"
              className="text-button tiny"
              onClick={() => setManual(!manual)}
            >
              {manual ? "자동 요금" : "금액 바꾸기"}
            </button>
          </span>
          {manual ? (
            <label className="amount">
              ₩
              <input
                type="number"
                min={0}
                step={1000}
                value={amount}
                aria-label="받을 금액"
                onChange={(e) =>
                  setAmount(
                    Math.max(0, Math.round(Number(e.target.value) || 0)),
                  )
                }
              />
            </label>
          ) : (
            <b className="num">{wonSign(price)}</b>
          )}
        </div>
        <button
          type="button"
          className="cta"
          disabled={busy}
          onClick={() => void submit()}
        >
          <KeyRound size={18} strokeWidth={2.2} />
          {room.number}호{" "}
          {mode === "hourly"
            ? future
              ? `${hm(startMs)} 대실 예약 넣기`
              : "대실 체크인"
            : `${label} 체크인`}
          {sheet && (
            <>
              {" "}
              · <span className="num">{wonSign(price)}</span>
            </>
          )}
        </button>
        <div className="subacts">
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void command(
                "room.update",
                { id: room.id, version: room.version, cleaning: "dirty" },
                { undoLabel: `${room.number}호 청소로 돌렸어요` },
              )
            }
          >
            <Sparkles size={14} />
            청소로 돌리기
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void command(
                "room.update",
                { id: room.id, version: room.version, facility: "inspection" },
                { undoLabel: `${room.number}호 점검으로 돌렸어요` },
              )
            }
          >
            <Wrench size={14} />
            점검으로 돌리기
          </button>
        </div>
      </div>
    </>
  );
}

export function RoomStateTab({
  ctx,
  room,
  floorKey,
  busy,
  command,
}: {
  ctx: Ctx;
  room: Room;
  floorKey: string;
  busy: boolean;
  command: CommandFn;
}) {
  const { s } = ctx;
  const [label, setLabel] = useState(room.label || "");
  useEffect(() => setLabel(room.label || ""), [room.label, room.id]);
  const [showIssue, setShowIssue] = useState(false);
  const issues = s.issues.filter((i) => i.roomId === room.id);
  const active = issues.filter((i) => i.status !== "resolved");
  const keep = { close: false };
  return (
    <div className="p-b scroll">
      <div className="two">
        <label className="flabel2">
          청소 상태
          <select
            value={room.cleaning}
            disabled={busy}
            onChange={(e) =>
              void command(
                "room.update",
                {
                  id: room.id,
                  version: room.version,
                  cleaning: e.target.value,
                },
                {
                  ...keep,
                  undoLabel: `${room.number}호 ${cleaningLabels[e.target.value as keyof typeof cleaningLabels]}`,
                },
              )
            }
          >
            {Object.entries(cleaningLabels).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flabel2">
          시설 · 판매 상태
          <select
            value={room.facility}
            disabled={busy}
            onChange={(e) =>
              void command(
                "room.update",
                {
                  id: room.id,
                  version: room.version,
                  facility: e.target.value,
                },
                {
                  ...keep,
                  undoLabel: `${room.number}호 ${facilityLabels[e.target.value as keyof typeof facilityLabels]}`,
                },
              )
            }
          >
            {Object.entries(facilityLabels).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="helper">
        판매 중지는 객실 전체 일정에 적용돼요. 판매를 다시 하려면 정상으로 바꿔
        주세요.
      </p>
      <section className="sect">
        <h3>특수객실 표시</h3>
        <p className="helper">
          색은 방 칸 왼쪽 띠와 이름표로만 보여서, 사용중·청소 같은 상태 무늬는
          그대로 보여요.
        </p>
        <ColorPicker
          label={`${room.number}호 색`}
          value={room.color}
          disabled={busy}
          onChange={(hex) =>
            void command(
              "room.update",
              { id: room.id, version: room.version, color: hex },
              keep,
            )
          }
        />
        <form
          className="label-form"
          onSubmit={(e) => {
            e.preventDefault();
            void command(
              "room.update",
              { id: room.id, version: room.version, label: label.trim() },
              keep,
            );
          }}
        >
          <input
            value={label}
            maxLength={12}
            placeholder="이름표 (예: 스위트, 월풋, 반려동물)"
            aria-label="특수객실 이름표"
            onChange={(e) => setLabel(e.target.value)}
          />
          <button
            className="btn sm"
            disabled={busy || label.trim() === (room.label || "")}
          >
            저장
          </button>
        </form>
      </section>
      <section className="sect">
        <h3>{room.floor}층 색</h3>
        <ColorPicker
          label={`${room.floor}층 색`}
          value={s.floorColors[floorKey]}
          disabled={busy}
          onChange={(hex) =>
            void command(
              "floor.update",
              { building: room.building, floor: room.floor, color: hex },
              keep,
            )
          }
        />
      </section>
      <section className="sect">
        <div className="sect-head">
          <h3>
            객실 인수인계{" "}
            <span>
              {active.length}/{s.limits.maxOpenIssues} 미해결
            </span>
          </h3>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setShowIssue(!showIssue)}
          >
            <Plus size={15} />
            기록 추가
          </button>
        </div>
        {showIssue && (
          <form
            className="issue-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              if (
                await command(
                  "issue.create",
                  {
                    roomId: room.id,
                    title: f.get("title"),
                    detail: f.get("detail"),
                    category: f.get("category"),
                    priority: f.get("priority"),
                  },
                  keep,
                )
              )
                setShowIssue(false);
            }}
          >
            <label className="flabel2">
              제목
              <input
                required
                maxLength={100}
                name="title"
                placeholder="예: 에어컨 작동 시 소음"
              />
            </label>
            <div className="two">
              <label className="flabel2">
                분류
                <select name="category">
                  <option value="repair">고장·수리</option>
                  <option value="condition">컨디션</option>
                  <option value="other">기타</option>
                </select>
              </label>
              <label className="flabel2">
                중요도
                <select name="priority">
                  <option value="normal">일반</option>
                  <option value="urgent">긴급</option>
                </select>
              </label>
            </div>
            <label className="flabel2">
              내용
              <textarea name="detail" rows={2} maxLength={1000} />
            </label>
            <div className="form-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => setShowIssue(false)}
              >
                접기
              </button>
              <button className="btn solid" disabled={busy}>
                인수인계 저장
              </button>
            </div>
          </form>
        )}
        {issues.length ? (
          issues.map((issue) => (
            <div
              className={`issue ${issue.status === "resolved" ? "resolved" : ""}`}
              key={issue.id}
            >
              <div className="issue-top">
                <span
                  className={`pill-s ${issue.status === "resolved" ? "neutral" : issue.priority === "urgent" ? "red" : "amber"}`}
                >
                  {issue.status === "resolved"
                    ? "해결 완료"
                    : issue.status === "in_progress"
                      ? "처리 중"
                      : issue.priority === "urgent"
                        ? "긴급"
                        : "접수"}
                </span>
                <strong>{issue.title}</strong>
              </div>
              {issue.detail && <p>{issue.detail}</p>}
              <div className="issue-bottom">
                <small>
                  {new Date(issue.createdAt).toLocaleDateString("ko-KR", {
                    timeZone: "Asia/Seoul",
                  })}{" "}
                  작성
                </small>
                <span>
                  {issue.status === "open" && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void command(
                          "issue.update",
                          {
                            id: issue.id,
                            version: issue.version,
                            status: "in_progress",
                          },
                          keep,
                        )
                      }
                    >
                      처리 시작
                    </button>
                  )}
                  {issue.status !== "resolved" ? (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void command(
                          "issue.update",
                          {
                            id: issue.id,
                            version: issue.version,
                            status: "resolved",
                          },
                          keep,
                        )
                      }
                    >
                      <Check size={13} /> 해결
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void command(
                          "issue.update",
                          {
                            id: issue.id,
                            version: issue.version,
                            status: "open",
                          },
                          keep,
                        )
                      }
                    >
                      다시 열기
                    </button>
                  )}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="quiet">아직 기록된 인수인계가 없어요.</p>
        )}
      </section>
    </div>
  );
}
