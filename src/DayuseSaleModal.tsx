import { useEffect, useState } from "react";
import { type Booking, type HotelSettings, won } from "../shared/ledger";
import {
  DAYUSE_SALE_METHOD_LABEL,
  DAYUSE_SALE_METHODS,
  DAYUSE_SALE_TITLE,
  dayuseSalePlatformId,
  planDayuseSale,
  type DayuseSaleInput,
} from "../shared/dayuseSale";
import type { BookPayMethod } from "../shared/payment";
import { Chip, ChipGroup, PriceInp } from "./primitives";
import { lookups } from "./ui";

/**
 * 「현황」대실 판매 전용 모달 — Entry 우회 · selection-first.
 * 선택 호실 고정 · MiniFloorPlan 금지 (헤더 간단 예약 Path는 별도).
 */
export default function DayuseSaleModal({
  s,
  today,
  initialRoomId,
  initialTypeId,
  busy,
  onCancel,
  onConfirm,
}: {
  s: HotelSettings;
  today: string;
  bookings: Booking[];
  initialRoomId: string;
  initialTypeId: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (input: DayuseSaleInput) => void;
}) {
  const L = lookups(s);
  const defaults = s.dayuseDefaults;
  const roomId = initialRoomId;
  const typeId = initialTypeId;
  const [startTime, setStartTime] = useState(defaults.startTime || "14:00");
  const [endTime, setEndTime] = useState(defaults.endTime || "17:00");
  const [price, setPrice] = useState(defaults.price > 0 ? String(defaults.price) : "");
  const [guestName, setGuestName] = useState("");
  const [collect, setCollect] = useState(defaults.price > 0);
  const [method, setMethod] = useState<BookPayMethod>("card");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setStartTime(defaults.startTime || "14:00");
    setEndTime(defaults.endTime || "17:00");
    setPrice(defaults.price > 0 ? String(defaults.price) : "");
    setCollect(defaults.price > 0);
    setGuestName("");
    setErr(null);
  }, [defaults.startTime, defaults.endTime, defaults.price, initialRoomId, initialTypeId]);

  const roomLabel = L.roomLabel(roomId) ?? s.floors.flatMap((f) => f.rooms).find((r) => r.id === roomId)?.no ?? roomId;
  const typeName = L.types.get(typeId)?.name ?? "";

  const submit = () => {
    if (busy) return;
    const input: DayuseSaleInput = {
      roomId,
      typeId,
      checkIn: today,
      startTime: startTime.trim().slice(0, 5),
      endTime: endTime.trim().slice(0, 5),
      price: Number(price || 0),
      guestName,
      platformId: dayuseSalePlatformId(s),
      collect: collect && Number(price || 0) > 0,
      method,
      bizDate: today,
    };
    const planned = planDayuseSale(s, input);
    if ("err" in planned) {
      setErr(planned.err);
      return;
    }
    setErr(null);
    onConfirm(input);
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal dayuse-sale-modal"
        role="dialog"
        aria-label={DAYUSE_SALE_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{DAYUSE_SALE_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p className="dayuse-sale-rooms" aria-label="선택 호실">
            <b>
              {roomLabel}호{typeName ? ` · ${typeName}` : ""}
            </b>{" "}
            · 오늘
          </p>
          <div className="dayuse-sale-times">
            <label className="dayuse-sale-field">
              <span className="muted sm">시작</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="14:00"
                aria-label="대실 시작"
                disabled={busy}
                value={startTime}
                onChange={(e) => {
                  setStartTime(e.target.value.slice(0, 5));
                  setErr(null);
                }}
              />
            </label>
            <span className="muted sm" aria-hidden>
              ~
            </span>
            <label className="dayuse-sale-field">
              <span className="muted sm">끝</span>
              <input
                type="text"
                inputMode="numeric"
                placeholder="17:00"
                aria-label="대실 끝"
                disabled={busy}
                value={endTime}
                onChange={(e) => {
                  setEndTime(e.target.value.slice(0, 5));
                  setErr(null);
                }}
              />
            </label>
          </div>
          <div className="paytake">
            <PriceInp sm>
              <span className="pl">판매가</span>
              <input
                className="num"
                inputMode="numeric"
                placeholder="0"
                aria-label="대실 판매가"
                disabled={busy}
                value={price ? won(Number(price)) : ""}
                onChange={(e) => {
                  const raw = e.target.value.replace(/\D/g, "").slice(0, 9);
                  setPrice(raw);
                  if (!raw || Number(raw) === 0) setCollect(false);
                  setErr(null);
                }}
              />
            </PriceInp>
          </div>
          <label className="dayuse-sale-field dayuse-sale-name">
            <span className="muted sm">이름 (선택)</span>
            <input
              type="text"
              placeholder="비우면 바로입실 표시명"
              aria-label="손님 이름"
              disabled={busy}
              value={guestName}
              onChange={(e) => {
                setGuestName(e.target.value.slice(0, 40));
                setErr(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
            />
          </label>
          {Number(price || 0) > 0 ? (
            <div className="dayuse-sale-collect">
              <ChipGroup role="group" aria-label="수납">
                <Chip
                  sm
                  active={collect}
                  disabled={busy}
                  aria-pressed={collect}
                  onClick={() => {
                    setCollect(true);
                    setErr(null);
                  }}
                >
                  지금 받기
                </Chip>
                <Chip
                  sm
                  active={!collect}
                  disabled={busy}
                  aria-pressed={!collect}
                  onClick={() => {
                    setCollect(false);
                    setErr(null);
                  }}
                >
                  나중에
                </Chip>
              </ChipGroup>
              {collect ? (
                <ChipGroup role="group" aria-label="결제 방법">
                  {DAYUSE_SALE_METHODS.map((m) => (
                    <Chip
                      key={m}
                      sm
                      active={method === m}
                      disabled={busy}
                      aria-pressed={method === m}
                      onClick={() => {
                        setMethod(m);
                        setErr(null);
                      }}
                    >
                      {DAYUSE_SALE_METHOD_LABEL[m]}
                    </Chip>
                  ))}
                </ChipGroup>
              ) : null}
            </div>
          ) : null}
          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn info" disabled={busy} onClick={submit} autoFocus>
            {busy ? "저장 중…" : DAYUSE_SALE_TITLE}
          </button>
        </div>
      </div>
    </div>
  );
}
