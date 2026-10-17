import { useState, type FormEvent } from "react";
import { LogIn, LogOut } from "lucide-react";
import type { AppState, Reservation } from "../../shared/types";
import {
  addDays,
  channelName,
  cleaningLabels,
  type CommandFn,
  hm,
  isHourly,
  isISODate,
  paymentLabels,
  roomNumbers,
  statusLabels,
  won,
} from "../lib";

export function StatusPill({ status }: { status: Reservation["status"] }) {
  return (
    <span
      className={`pill-s ${status === "checked_in" ? "blue" : status === "confirmed" ? "green" : status === "cancelled" ? "red" : "neutral"}`}
    >
      {statusLabels[status]}
    </span>
  );
}

export function ReservationForm({
  state: s,
  reservation: r,
  busy,
  command,
  onCancel,
  now,
}: {
  state: AppState;
  reservation?: Reservation;
  busy: boolean;
  command: CommandFn;
  onCancel: (r: Reservation) => void;
  now: number;
}) {
  if (r && isHourly(r))
    return (
      <HourlyDetail
        s={s}
        r={r}
        busy={busy}
        command={command}
        onCancel={onCancel}
        now={now}
      />
    );
  return (
    <NightlyForm
      s={s}
      r={r}
      busy={busy}
      command={command}
      onCancel={onCancel}
    />
  );
}

function HourlyDetail({
  s,
  r,
  busy,
  command,
  onCancel,
  now,
}: {
  s: AppState;
  r: Reservation;
  busy: boolean;
  command: CommandFn;
  onCancel: (r: Reservation) => void;
  now: number;
}) {
  const canIn =
    r.status === "confirmed" &&
    Date.parse(r.startAt!) - now <= 2 * 3600000 &&
    Date.parse(r.endAt!) > now;
  return (
    <>
      <div className="form-intro">
        <StatusPill status={r.status} />{" "}
        <span className="pill-s sky">대실</span>
        <span className="reservation-id">예약번호 {r.id}</span>
      </div>
      <dl className="facts">
        <div>
          <dt>손님</dt>
          <dd>
            {r.guestName}
            {r.phone ? ` · ${r.phone}` : ""}
          </dd>
        </div>
        <div>
          <dt>방</dt>
          <dd>{roomNumbers(s, r)}호</dd>
        </div>
        <div>
          <dt>시간</dt>
          <dd className="num">
            {hm(r.startAt!)} → {hm(r.endAt!)} · {r.hours}시간
          </dd>
        </div>
        <div>
          <dt>영업일</dt>
          <dd>{r.checkIn}</dd>
        </div>
        <div>
          <dt>채널 · 결제</dt>
          <dd>
            {channelName(s, r.channelId)}
            {r.payment ? ` · ${paymentLabels[r.payment]}` : ""}
          </dd>
        </div>
        <div>
          <dt>금액</dt>
          <dd className="num">
            {won(r.totalAmount)}
            {r.feeAmount ? ` (수수료 ${won(r.feeAmount)})` : ""}
          </dd>
        </div>
        {r.memo && (
          <div>
            <dt>메모</dt>
            <dd>{r.memo}</dd>
          </div>
        )}
      </dl>
      <p className="helper">
        대실은 내용을 바꾸지 않아요. 시간이나 방을 바꾸려면 취소하고 다시 넣어
        주세요.
      </p>
      <div className="form-actions">
        {r.status === "confirmed" && (
          <button
            type="button"
            className="text-button danger"
            disabled={busy}
            onClick={() => onCancel(r)}
          >
            대실 예약 취소
          </button>
        )}
        {r.status === "confirmed" && (
          <button
            type="button"
            className="btn solid"
            disabled={busy || !canIn}
            onClick={() =>
              void command(
                "reservation.checkin",
                { id: r.id, version: r.version },
                { undoLabel: `${roomNumbers(s, r)}호 대실 체크인했어요` },
              )
            }
          >
            <LogIn size={16} />
            {canIn ? "대실 체크인" : "시작 2시간 전부터 체크인"}
          </button>
        )}
        {r.status === "checked_in" && (
          <button
            type="button"
            className="btn coral"
            disabled={busy}
            onClick={() =>
              void command(
                "reservation.checkout",
                { id: r.id, version: r.version },
                { undoLabel: `${roomNumbers(s, r)}호 퇴실 처리했어요` },
              )
            }
          >
            <LogOut size={16} />
            퇴실 처리
          </button>
        )}
      </div>
    </>
  );
}

function NightlyForm({
  s,
  r,
  busy,
  command,
  onCancel,
}: {
  s: AppState;
  r?: Reservation;
  busy: boolean;
  command: CommandFn;
  onCancel: (r: Reservation) => void;
}) {
  const initialDate = s.selectedDate < s.today ? s.today : s.selectedDate;
  const [checkIn, setCheckIn] = useState(r?.checkIn ?? initialDate);
  const [checkOut, setCheckOut] = useState(
    r?.checkOut ?? addDays(initialDate, 1),
  );
  const [typeId, setTypeId] = useState(r?.typeId ?? s.roomTypes[0]?.id ?? "");
  const [quantity, setQuantity] = useState(r?.quantity ?? 1);
  const [nightlyRate, setNightlyRate] = useState(
    r?.nightlyRate ?? s.roomTypes[0]?.baseRate ?? 0,
  );
  const [assign, setAssign] = useState<string[]>(r?.roomIds ?? []);
  const [formError, setFormError] = useState("");
  const validDates =
    isISODate(checkIn) && isISODate(checkOut) && checkOut > checkIn;
  const nights = validDates
    ? Math.round(
        (new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000,
      )
    : 0;
  const total = nightlyRate * quantity * nights;
  const locked =
    !!r &&
    (!!r.clipped ||
      ["cancelled", "checked_out", "checked_in"].includes(r.status));
  const canCancel = r?.status === "confirmed";
  const candidate = s.rooms.filter(
    (room) => room.typeId === typeId && room.facility === "normal",
  );
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validDates) {
      setFormError(
        "체크인과 체크아웃 날짜를 올바르게 선택해 주세요. 체크아웃은 체크인 다음 날부터 가능합니다.",
      );
      return;
    }
    setFormError("");
    const f = new FormData(e.currentTarget);
    void command(r ? "reservation.update" : "reservation.create", {
      ...(r ? { id: r.id, version: r.version } : {}),
      guestName: f.get("guestName"),
      phone: f.get("phone"),
      typeId,
      quantity,
      checkIn,
      checkOut,
      channelId: f.get("channelId"),
      nightlyRate,
      memo: f.get("memo"),
    });
  }
  const canCheckIn =
    !!r &&
    r.roomIds.length === r.quantity &&
    ((r.checkIn <= s.today && r.checkOut > s.today) ||
      (!!s.lateArrivalDate &&
        r.checkIn <= s.lateArrivalDate &&
        r.checkOut > s.lateArrivalDate));
  return (
    <>
      <div className="form-intro">
        {r ? (
          <>
            <StatusPill status={r.status} />
            <span className="reservation-id">예약번호 {r.id}</span>
            {r.clipped && (
              <span>
                조회 기간에 포함된 숙박일만 표시되어 일정 수정이 제한됩니다.
              </span>
            )}
          </>
        ) : (
          <>
            예약 가능한 숙박일: {s.today} ~ {addDays(s.limits.futureEnd, -1)} ·
            외부 예약 사이트의 재고는 따로 확인해 주세요. 대실은 건물·시간표
            화면에서 방을 눌러 넣어요.
          </>
        )}
      </div>
      <form onSubmit={submit}>
        {formError && (
          <div className="form-error" role="alert">
            {formError}
          </div>
        )}
        <fieldset disabled={busy || locked} className="plain">
          <div className="fields two">
            <label className="flabel2">
              고객명 <span className="req">*</span>
              <input
                name="guestName"
                defaultValue={r?.guestName}
                required
                maxLength={60}
                placeholder="예약자 이름"
              />
            </label>
            <label className="flabel2">
              연락처
              <input
                name="phone"
                defaultValue={r?.phone}
                type="tel"
                maxLength={30}
                placeholder="선택 입력"
              />
            </label>
            <label className="flabel2">
              체크인 <span className="req">*</span>
              <input
                type="date"
                value={checkIn}
                required
                min={r ? s.limits.historyStart : s.today}
                max={addDays(s.limits.futureEnd, -1)}
                onChange={(e) => setCheckIn(e.target.value)}
              />
            </label>
            <label className="flabel2">
              체크아웃 <span className="req">*</span>
              <input
                type="date"
                value={checkOut}
                required
                min={addDays(checkIn, 1) || undefined}
                max={s.limits.futureEnd}
                onChange={(e) => setCheckOut(e.target.value)}
              />
            </label>
            <label className="flabel2">
              객실 타입
              <select
                value={typeId}
                onChange={(e) => {
                  setTypeId(e.target.value);
                  if (!r)
                    setNightlyRate(
                      s.roomTypes.find((t) => t.id === e.target.value)
                        ?.baseRate ?? nightlyRate,
                    );
                }}
              >
                {s.roomTypes.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flabel2">
              객실 수
              <input
                type="number"
                value={quantity}
                min={1}
                max={999}
                required
                step={1}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
            </label>
            <label className="flabel2">
              예약 채널
              <select
                name="channelId"
                defaultValue={r?.channelId || s.channels[0]?.id}
              >
                {s.channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flabel2">
              객실당 1박 판매금액 (원)
              <input
                type="number"
                min={0}
                max={999999999}
                step={1}
                required
                value={nightlyRate}
                onChange={(e) => setNightlyRate(Number(e.target.value))}
              />
            </label>
            <label className="flabel2 full">
              운영 메모
              <textarea
                name="memo"
                defaultValue={r?.memo}
                rows={2}
                maxLength={1000}
                placeholder="동료와 공유할 내용을 남겨 주세요"
              />
            </label>
          </div>
        </fieldset>
        <div className="res-sum">
          <span>
            {validDates
              ? `${nights}박 · ${quantity}실`
              : "숙박 날짜를 선택해 주세요"}
          </span>
          <span>
            총 판매금액 <strong className="num">{won(total)}</strong>
          </span>
        </div>
        {(!locked || canCancel) && (
          <div className="form-actions">
            {canCancel && r && (
              <button
                type="button"
                disabled={busy}
                className="text-button danger"
                onClick={() => onCancel(r)}
              >
                예약 취소
              </button>
            )}
            {!locked && (
              <button className="btn solid" disabled={busy}>
                {busy ? "저장 중…" : r ? "변경사항 저장" : "예약 등록"}
              </button>
            )}
          </div>
        )}
      </form>
      {r && r.status === "confirmed" && (
        <div className="ops">
          <h3>객실 배정 및 입실</h3>
          <p className="helper">
            배정할 객실을 {r.quantity}개 고르세요. 청소·시설·예약 충돌은 저장할
            때 다시 확인해요.
          </p>
          <div className="assign">
            {candidate.map((room) => (
              <label
                key={room.id}
                className={assign.includes(room.id) ? "on" : ""}
              >
                <input
                  type="checkbox"
                  checked={assign.includes(room.id)}
                  onChange={(e) =>
                    setAssign(
                      e.target.checked
                        ? [...assign, room.id]
                        : assign.filter((id) => id !== room.id),
                    )
                  }
                />
                <b className="num">{room.number}</b>
                <small>{cleaningLabels[room.cleaning]}</small>
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button
              type="button"
              className="btn"
              disabled={busy || assign.length !== r.quantity}
              onClick={() =>
                void command(
                  "reservation.assign",
                  { id: r.id, version: r.version, roomIds: assign },
                  { undoLabel: "객실을 배정했어요" },
                )
              }
            >
              객실 배정 저장
            </button>
            <button
              type="button"
              className="btn coral"
              disabled={busy || !canCheckIn}
              onClick={() =>
                void command(
                  "reservation.checkin",
                  { id: r.id, version: r.version },
                  { undoLabel: `${roomNumbers(s, r)}호 체크인했어요` },
                )
              }
            >
              <LogIn size={16} />
              {r.checkIn > s.today ? "입실일에 체크인" : "체크인"}
            </button>
          </div>
        </div>
      )}
      {r?.status === "checked_in" && (
        <div className="form-actions">
          <button
            type="button"
            className="btn coral"
            disabled={busy || r.checkOut > s.today}
            onClick={() =>
              void command(
                "reservation.checkout",
                { id: r.id, version: r.version },
                { undoLabel: `${roomNumbers(s, r)}호 퇴실 처리했어요` },
              )
            }
          >
            <LogOut size={16} />
            {r.checkOut > s.today ? "퇴실일에 체크아웃" : "체크아웃 처리"}
          </button>
        </div>
      )}
    </>
  );
}
