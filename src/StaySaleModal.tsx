import { useEffect, useMemo, useState } from "react";
import {
  type Booking,
  type HotelSettings,
  allRooms,
  typeLabel,
  won,
} from "../shared/ledger";
import {
  STAY_SALE_CTA,
  STAY_SALE_TITLE,
  staySaleExtendPreview,
  staySalePlatformId,
  type StaySaleCreateInput,
  type StaySaleOccupiedInput,
} from "../shared/staySale";
import { type BookPayMethod, type OnsitePayMode, isOnsite } from "../shared/payment";
import { ADD_TIME_HOUR_CHIPS, ADD_TIME_METHOD_LABEL, ADD_TIME_METHODS, type AddTimeMethod } from "../shared/addTime";
import { EARLY_IN_HOUR_CHIPS, EARLY_IN_PAY_LABEL, EARLY_IN_PAY_METHODS, type EarlyInPayMethod } from "../shared/earlyInPay";
import { canExtend } from "../shared/extend";
import { Chip, ChipGroup, GuestNamePhone, PriceInp, Stepper } from "./primitives";
import OnsitePayModeFields from "./OnsitePayModeFields";
import { lookups } from "./ui";

/**
 * 「현황」숙박 판매 전용 — selection-first.
 * 선택 호실 읽기 전용 · MiniFloorPlan 금지 · 공실=신규 · 점유=연장·입·퇴.
 */
export default function StaySaleModal({
  s,
  today,
  roomIds,
  roomLabels,
  occupied,
  busy,
  onCancel,
  onConfirmCreate,
  onConfirmOccupied,
}: {
  s: HotelSettings;
  today: string;
  roomIds: string[];
  roomLabels: string[];
  /** 점유 숙박이면 연장·입·퇴 모드 */
  occupied: Booking | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirmCreate: (input: StaySaleCreateInput) => void;
  onConfirmOccupied: (input: StaySaleOccupiedInput) => void;
}) {
  const L = lookups(s);
  const isOcc = !!occupied;
  const platId = staySalePlatformId(s);
  const plat = s.platforms.find((p) => p.id === platId);
  const onsite = isOnsite(plat);

  const [guestName, setName] = useState(occupied?.guestName ?? "");
  const [guestPhone, setPhone] = useState(occupied?.guestPhone ?? "");
  const [guests, setGuests] = useState(occupied?.guests ?? 1);
  const [nights, setNights] = useState(Math.max(1, occupied?.nights ?? 1));
  const [price, setPrice] = useState(occupied && occupied.price > 0 ? String(occupied.price) : "");
  const [payMode, setPayMode] = useState<OnsitePayMode>("postpaid");
  const [depAmt, setDepAmt] = useState("");
  const [depMethod, setDepMethod] = useState<BookPayMethod>("card");
  const [extend, setExtend] = useState(false);
  const [earlyH, setEarlyH] = useState(0);
  const [earlyAmt, setEarlyAmt] = useState("");
  const [earlyMethod, setEarlyMethod] = useState<EarlyInPayMethod>("service");
  const [lateH, setLateH] = useState(0);
  const [lateAmt, setLateAmt] = useState("");
  const [lateMethod, setLateMethod] = useState<AddTimeMethod>("service");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(occupied?.guestName ?? "");
    setPhone(occupied?.guestPhone ?? "");
    setGuests(occupied?.guests ?? 1);
    setNights(Math.max(1, occupied?.nights ?? 1));
    setPrice(occupied && occupied.price > 0 ? String(occupied.price) : "");
    setExtend(false);
    setEarlyH(0);
    setEarlyAmt("");
    setEarlyMethod("service");
    setLateH(0);
    setLateAmt("");
    setLateMethod("service");
    setErr(null);
  }, [occupied?.id, roomIds.join(",")]);

  const typeNames = useMemo(() => {
    const rmap = new Map(allRooms(s).map((r) => [r.id, r]));
    return roomIds.map((id) => {
      const tid = occupied?.typeId ?? rmap.get(id)?.typeId;
      return typeLabel(tid ? L.types.get(tid) : undefined) || "타입";
    });
  }, [s, roomIds, occupied, L.types]);

  const headLine = roomLabels.map((n, i) => `${n}호 · ${typeNames[i] ?? ""}`).join(" · ");

  const extendPrev = occupied ? staySaleExtendPreview(occupied, null) : null;
  const showExtend = isOcc && occupied && canExtend(occupied);

  const submit = () => {
    if (busy) return;
    if (isOcc && occupied) {
      if (!extend && earlyH < 1 && lateH < 1) {
        setErr("1박 연장 · 빠른 입실 · 늦은 퇴실 중 하나를 골라 주세요.");
        return;
      }
      setErr(null);
      onConfirmOccupied({
        bookingId: occupied.id,
        extend,
        earlyInHours: earlyH || undefined,
        earlyInAmount: earlyMethod === "service" ? 0 : Number(earlyAmt || 0),
        earlyInMethod: earlyMethod,
        lateOutHours: lateH || undefined,
        lateOutAmount: lateMethod === "service" ? 0 : Number(lateAmt || 0),
        lateOutMethod: lateMethod,
        bizDate: today,
      });
      return;
    }
    const input: StaySaleCreateInput = {
      roomIds,
      checkIn: today,
      nights,
      guestName,
      guestPhone,
      guests,
      price: Number(price || 0),
      platformId: platId,
      payMode: onsite ? payMode : "postpaid",
      depAmt,
      depMethod,
      bizDate: today,
      earlyInHours: earlyH || undefined,
      earlyInAmount: earlyMethod === "service" ? 0 : Number(earlyAmt || 0),
      earlyInMethod: earlyMethod,
      lateOutHours: lateH || undefined,
      lateOutAmount: lateMethod === "service" ? 0 : Number(lateAmt || 0),
      lateOutMethod: lateMethod,
      walkInImmediate: false,
    };
    setErr(null);
    onConfirmCreate(input);
  };

  return (
    <div className="dim assign-type-dim" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="modal assign-type-modal stay-sale-modal"
        role="dialog"
        aria-label={STAY_SALE_TITLE}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mh">
          <h2>{STAY_SALE_TITLE}</h2>
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p className="stay-sale-rooms" aria-label="선택 호실">
            <b>{headLine}</b>
            {isOcc ? <span className="muted sm"> · 점유 · 연장·입·퇴</span> : <span className="muted sm"> · 오늘</span>}
          </p>

          {!isOcc ? (
            <>
              <div className="fld">
                <label>손님</label>
                <GuestNamePhone
                  name={guestName}
                  phone={guestPhone ?? ""}
                  onName={setName}
                  onPhone={setPhone}
                  phoneRequired={onsite}
                />
              </div>
              <div className="fld">
                <label>인원</label>
                <Stepper value={guests} min={1} max={12} onChange={setGuests} />
              </div>
              <div className="fld">
                <label>박수</label>
                <Stepper value={nights} unit="박" min={1} max={30} onChange={setNights} />
              </div>
              <div className="paytake">
                <PriceInp sm>
                  <span className="pl">판매가</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    placeholder="0"
                    aria-label="판매가"
                    disabled={busy}
                    value={price ? won(Number(price)) : ""}
                    onChange={(e) => {
                      setPrice(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setErr(null);
                    }}
                  />
                </PriceInp>
              </div>
              {onsite ? (
                <OnsitePayModeFields
                  payMode={payMode}
                  onPayMode={setPayMode}
                  depAmt={depAmt}
                  onDepAmt={setDepAmt}
                  depMethod={depMethod}
                  onDepMethod={setDepMethod}
                />
              ) : null}
            </>
          ) : null}

          {showExtend ? (
            <div className="fld">
              <label>1박 연장</label>
              <ChipGroup role="group" aria-label="1박 연장">
                <Chip
                  sm
                  active={extend}
                  disabled={busy}
                  aria-pressed={extend}
                  onClick={() => {
                    setExtend((v) => !v);
                    setErr(null);
                  }}
                >
                  +1박
                  {extendPrev ? ` · ${won(extendPrev.rate)}원` : ""}
                </Chip>
              </ChipGroup>
            </div>
          ) : null}

          <div className="fld">
            <label>빠른 입실</label>
            <ChipGroup role="group" aria-label="빠른 입실 시간">
              <Chip sm active={earlyH === 0} disabled={busy} onClick={() => setEarlyH(0)}>
                없음
              </Chip>
              {EARLY_IN_HOUR_CHIPS.map((h) => (
                <Chip key={h} sm active={earlyH === h} disabled={busy} onClick={() => setEarlyH(h)}>
                  {h}시간
                </Chip>
              ))}
            </ChipGroup>
            {earlyH > 0 ? (
              <div className="stay-sale-extra">
                <PriceInp sm>
                  <span className="pl">금액</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    disabled={busy || earlyMethod === "service"}
                    value={earlyMethod === "service" ? "" : earlyAmt ? won(Number(earlyAmt)) : ""}
                    onChange={(e) => setEarlyAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    aria-label="빠른 입실 금액"
                  />
                </PriceInp>
                <ChipGroup role="group" aria-label="빠른 입실 결제">
                  {EARLY_IN_PAY_METHODS.map((m) => (
                    <Chip key={m} sm active={earlyMethod === m} disabled={busy} onClick={() => setEarlyMethod(m)}>
                      {EARLY_IN_PAY_LABEL[m]}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
            ) : null}
          </div>

          <div className="fld">
            <label>늦은 퇴실</label>
            <ChipGroup role="group" aria-label="늦은 퇴실 시간">
              <Chip sm active={lateH === 0} disabled={busy} onClick={() => setLateH(0)}>
                없음
              </Chip>
              {ADD_TIME_HOUR_CHIPS.map((h) => (
                <Chip key={h} sm active={lateH === h} disabled={busy} onClick={() => setLateH(h)}>
                  +{h}시간
                </Chip>
              ))}
            </ChipGroup>
            {lateH > 0 ? (
              <div className="stay-sale-extra">
                <PriceInp sm>
                  <span className="pl">금액</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    disabled={busy || lateMethod === "service"}
                    value={lateMethod === "service" ? "" : lateAmt ? won(Number(lateAmt)) : ""}
                    onChange={(e) => setLateAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    aria-label="늦은 퇴실 금액"
                  />
                </PriceInp>
                <ChipGroup role="group" aria-label="늦은 퇴실 결제">
                  {ADD_TIME_METHODS.map((m) => (
                    <Chip key={m} sm active={lateMethod === m} disabled={busy} onClick={() => setLateMethod(m)}>
                      {ADD_TIME_METHOD_LABEL[m]}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
            ) : null}
          </div>

          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          <button type="button" className="btn stop" disabled={busy} onClick={submit} autoFocus>
            {busy ? "저장 중…" : STAY_SALE_CTA}
          </button>
        </div>
      </div>
    </div>
  );
}
