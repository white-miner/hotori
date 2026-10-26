import { useEffect, useMemo, useState } from "react";
import {
  type Booking,
  type HotelSettings,
  allRooms,
  typeLabel,
  won,
} from "../shared/ledger";
import {
  STAY_SALE_CHECKIN,
  STAY_SALE_CTA,
  STAY_SALE_SAVE,
  STAY_SALE_TITLE,
  staySaleExtendPreview,
  staySaleNightsSummary,
  staySaleOtaPlatforms,
  staySalePlatformIdForMode,
  staySaleDraftSessionKey,
  staySaleResolvePrice,
  type StaySaleChannelMode,
  type StaySaleCreateInput,
  type StaySaleOccupiedInput,
  type StaySaleSalesMode,
} from "../shared/staySale";
import { type BookPayMethod, type OnsitePayMode, isOnsite } from "../shared/payment";
import { ADD_TIME_HOUR_CHIPS, ADD_TIME_METHOD_LABEL, ADD_TIME_METHODS, type AddTimeMethod } from "../shared/addTime";
import { EARLY_IN_HOUR_CHIPS, EARLY_IN_PAY_LABEL, EARLY_IN_PAY_METHODS, type EarlyInPayMethod } from "../shared/earlyInPay";
import { canExtend } from "../shared/extend";
import { Chip, ChipGroup, GuestNamePhone, PriceInp, PriceRow, Stepper } from "./primitives";
import OnsitePayModeFields from "./OnsitePayModeFields";
import { PlatBadge, lookups } from "./ui";

/**
 * 「현황」숙박 판매 전용 — selection-first.
 * 선택 호실 읽기 전용 · MiniFloorPlan 금지 · 현장|플랫폼 세그 · 공실=신규 · 점유=연장·입·퇴.
 * Option D: SimpleBooking을 열지 않음.
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
  const otaList = useMemo(() => staySaleOtaPlatforms(s), [s]);

  const [channel, setChannel] = useState<StaySaleChannelMode>("onsite");
  const [platformId, setPlatformId] = useState(() => staySalePlatformIdForMode(s, "onsite"));
  const [guestName, setName] = useState(occupied?.guestName ?? "");
  const [guestPhone, setPhone] = useState(occupied?.guestPhone ?? "");
  const [guests, setGuests] = useState(occupied?.guests ?? 1);
  const [nights, setNights] = useState(Math.max(1, occupied?.nights ?? 1));
  const [price, setPrice] = useState(occupied && occupied.price > 0 ? String(occupied.price) : "");
  const [salesMode, setSalesMode] = useState<StaySaleSalesMode>("total");
  const [perNight, setPerNight] = useState("");
  const [priceUnset, setPriceUnset] = useState(false);
  const [payMode, setPayMode] = useState<OnsitePayMode>("prepaid");
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

  const plat = s.platforms.find((p) => p.id === platformId);
  const onsite = isOnsite(plat);

  // Draft session = 선택 호실·점유 예약만 (`staySaleDraftSessionKey`).
  // `s`를 deps에 넣으면 10s poll이 settings 새 참조를 넣을 때마다 이름·전화가 지워짐.
  const draftSessionKey = staySaleDraftSessionKey(occupied?.id, roomIds);
  useEffect(() => {
    setChannel("onsite");
    setPlatformId(staySalePlatformIdForMode(s, "onsite"));
    setName(occupied?.guestName ?? "");
    setPhone(occupied?.guestPhone ?? "");
    setGuests(occupied?.guests ?? 1);
    setNights(Math.max(1, occupied?.nights ?? 1));
    setPrice(occupied && occupied.price > 0 ? String(occupied.price) : "");
    setSalesMode("total");
    setPerNight("");
    setPriceUnset(false);
    setPayMode("prepaid");
    setDepAmt("");
    setDepMethod("card");
    setExtend(false);
    setEarlyH(0);
    setEarlyAmt("");
    setEarlyMethod("service");
    setLateH(0);
    setLateAmt("");
    setLateMethod("service");
    setErr(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on draftSessionKey
  }, [draftSessionKey]);

  const typeNames = useMemo(() => {
    const rmap = new Map(allRooms(s).map((r) => [r.id, r]));
    return roomIds.map((id) => {
      const tid = occupied?.typeId ?? rmap.get(id)?.typeId;
      return typeLabel(tid ? L.types.get(tid) : undefined) || "타입";
    });
  }, [s, roomIds, occupied, L.types]);

  const headLine = roomLabels.map((n, i) => `${n}호 · ${typeNames[i] ?? ""}`).join(" · ");
  const stayCompact = !isOcc ? staySaleNightsSummary(today, nights) : null;

  const extendPrev = occupied ? staySaleExtendPreview(occupied, null) : null;
  const showExtend = isOcc && occupied && canExtend(occupied);

  const switchChannel = (next: StaySaleChannelMode) => {
    if (next === channel) return;
    setChannel(next);
    setPlatformId(staySalePlatformIdForMode(s, next));
    setSalesMode("total");
    setPerNight("");
    setPriceUnset(false);
    setPayMode("prepaid");
    setDepAmt("");
    setErr(null);
  };

  const submitOccupied = () => {
    if (busy || !occupied) return;
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
  };

  /** 저장하기=숙박예약 · 바로입실=저장+arrived (현장·플랫폼 공통) */
  const submitCreate = (walkInImmediate: boolean) => {
    if (busy) return;
    if (channel === "platform" && !otaList.length) {
      setErr("등록된 플랫폼 채널이 없어요.");
      return;
    }
    if (channel === "platform" && onsite) {
      setErr("플랫폼 채널을 골라 주세요.");
      return;
    }
    if (channel === "onsite" && !onsite) {
      setErr("현장·전화 채널이 없어요.");
      return;
    }
    const resolved = staySaleResolvePrice({
      channel,
      salesMode,
      priceUnset,
      total: Number(price || 0),
      perNight: Number(perNight || 0),
      nights,
    });
    const input: StaySaleCreateInput = {
      roomIds,
      checkIn: today,
      nights,
      guestName,
      guestPhone,
      guests,
      price: resolved,
      priceUnset: priceUnset || undefined,
      platformId,
      payMode: onsite ? payMode : "postpaid",
      depAmt: onsite ? depAmt : "",
      depMethod,
      bizDate: today,
      earlyInHours: channel === "onsite" && earlyH ? earlyH : undefined,
      earlyInAmount:
        channel === "onsite" && earlyH ? (earlyMethod === "service" ? 0 : Number(earlyAmt || 0)) : undefined,
      earlyInMethod: channel === "onsite" && earlyH ? earlyMethod : undefined,
      lateOutHours: channel === "onsite" && lateH ? lateH : undefined,
      lateOutAmount:
        channel === "onsite" && lateH ? (lateMethod === "service" ? 0 : Number(lateAmt || 0)) : undefined,
      lateOutMethod: channel === "onsite" && lateH ? lateMethod : undefined,
      walkInImmediate,
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
        <div className="mh stay-sale-mh">
          <h2>{STAY_SALE_TITLE}</h2>
          {!isOcc ? (
            <div className="seg sm stay-sale-mode" role="tablist" aria-label="숙박 판매 모드">
              <button
                type="button"
                role="tab"
                aria-selected={channel === "onsite"}
                className={channel === "onsite" ? "on" : ""}
                disabled={busy}
                onClick={() => switchChannel("onsite")}
              >
                현장
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={channel === "platform"}
                className={channel === "platform" ? "on" : ""}
                disabled={busy || !otaList.length}
                onClick={() => switchChannel("platform")}
                title={!otaList.length ? "등록된 플랫폼이 없어요" : "야놀자·에어비앤비 등"}
              >
                플랫폼
              </button>
            </div>
          ) : null}
          <button type="button" className="x" aria-label="닫기" disabled={busy} onClick={onCancel}>
            닫기
          </button>
        </div>
        <div className="mb">
          <p className="stay-sale-rooms" aria-label="선택 호실">
            <b>{headLine}</b>
            {isOcc ? (
              <span className="muted sm"> · 점유 · 연장·입·퇴</span>
            ) : stayCompact ? (
              <span className="muted sm"> · {stayCompact}</span>
            ) : null}
          </p>

          {!isOcc ? (
            <>
              {channel === "platform" ? (
                <div className="fld">
                  <label>채널</label>
                  <ChipGroup role="group" aria-label="플랫폼 채널">
                    {otaList.map((pl) => (
                      <Chip
                        key={pl.id}
                        sm
                        active={pl.id === platformId}
                        disabled={busy}
                        onClick={() => {
                          setPlatformId(pl.id);
                          setErr(null);
                        }}
                        title={pl.name}
                        aria-label={pl.name}
                      >
                        <PlatBadge p={pl} />
                        {pl.name}
                      </Chip>
                    ))}
                  </ChipGroup>
                </div>
              ) : null}

              <div className="fld">
                <label>
                  손님{channel === "onsite" ? <em>*</em> : null}
                  {channel === "onsite" ? (
                    <>
                      {" "}
                      · 연락처<em>*</em>
                    </>
                  ) : (
                    " · 연락처"
                  )}
                </label>
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
                <label>숙박</label>
                <Stepper
                  value={nights}
                  unit="박"
                  min={1}
                  max={30}
                  onChange={(n) => {
                    setNights(n);
                    setErr(null);
                  }}
                />
              </div>

              {channel === "onsite" ? (
                <>
                  <OnsitePayModeFields
                    part="chips"
                    payMode={payMode}
                    onPayMode={setPayMode}
                    depAmt={depAmt}
                    onDepAmt={setDepAmt}
                    depMethod={depMethod}
                    onDepMethod={setDepMethod}
                    disabled={busy}
                  />
                  <OnsitePayModeFields
                    part="method"
                    payMode={payMode}
                    onPayMode={setPayMode}
                    depAmt={depAmt}
                    onDepAmt={setDepAmt}
                    depMethod={depMethod}
                    onDepMethod={setDepMethod}
                    disabled={busy}
                  />
                  <div className="fld">
                    <label>판매가</label>
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
                  <OnsitePayModeFields
                    part="take"
                    payMode={payMode}
                    onPayMode={setPayMode}
                    depAmt={depAmt}
                    onDepAmt={setDepAmt}
                    depMethod={depMethod}
                    onDepMethod={setDepMethod}
                    disabled={busy}
                  />
                </>
              ) : (
                <div className="fld">
                  <label>판매금</label>
                  <div className="stay-sale-plat-price">
                    <div className="seg sm" role="tablist" aria-label="판매금 입력 모드">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={salesMode === "perNight"}
                        className={salesMode === "perNight" ? "on" : ""}
                        disabled={busy || priceUnset}
                        onClick={() => {
                          setSalesMode("perNight");
                          setErr(null);
                        }}
                      >
                        박당
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={salesMode === "total"}
                        className={salesMode === "total" ? "on" : ""}
                        disabled={busy || priceUnset}
                        onClick={() => {
                          setSalesMode("total");
                          setErr(null);
                        }}
                      >
                        총액
                      </button>
                    </div>
                    <label className="ck">
                      <input
                        type="checkbox"
                        checked={priceUnset}
                        disabled={busy}
                        onChange={(e) => {
                          setPriceUnset(e.target.checked);
                          if (e.target.checked) {
                            setPrice("");
                            setPerNight("");
                          }
                          setErr(null);
                        }}
                      />
                      금액미정
                    </label>
                    {!priceUnset ? (
                      salesMode === "total" ? (
                        <>
                          <PriceRow style={{ marginTop: "var(--space-chip)" }}>
                            <PriceInp total>
                              <input
                                className="num"
                                inputMode="numeric"
                                aria-label="판매금 총액"
                                placeholder="총액"
                                disabled={busy}
                                value={price ? won(Number(price)) : ""}
                                onChange={(e) => {
                                  setPrice(e.target.value.replace(/\D/g, "").slice(0, 9));
                                  setErr(null);
                                }}
                              />
                            </PriceInp>
                          </PriceRow>
                          <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                            플랫폼 총액 그대로
                            {Number(price) > 0 ? (
                              <>
                                {" · "}
                                <b>{won(Number(price))}원</b>
                                {nights > 1 ? ` · ${nights}박` : null}
                              </>
                            ) : null}
                          </div>
                        </>
                      ) : (
                        <>
                          <PriceRow style={{ marginTop: "var(--space-chip)" }}>
                            <PriceInp sm suffix="원/박">
                              <input
                                className="num"
                                inputMode="numeric"
                                aria-label="판매금 박당"
                                placeholder="1박"
                                disabled={busy}
                                value={perNight ? won(Number(perNight)) : ""}
                                onChange={(e) => {
                                  setPerNight(e.target.value.replace(/\D/g, "").slice(0, 9));
                                  setErr(null);
                                }}
                              />
                            </PriceInp>
                          </PriceRow>
                          {Number(perNight) > 0 ? (
                            <div className="muted sm" style={{ marginTop: "var(--space-chip)" }}>
                              총액 제안 <b>{won(Number(perNight) * nights)}원</b>
                              {nights > 1 ? ` · ${nights}박` : null}
                            </div>
                          ) : null}
                        </>
                      )
                    ) : null}
                  </div>
                </div>
              )}
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

          {/* 빠른입실·늦은퇴실: 현장 신규 + 점유. 플랫폼 신규는 채널·판매금만 */}
          {isOcc || channel === "onsite" ? (
            <>
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
            </>
          ) : null}

          {err ? <div className="ferr">{err}</div> : null}
        </div>
        <div className="mf assign-type-acts">
          <button type="button" className="btn line" disabled={busy} onClick={onCancel}>
            취소
          </button>
          {isOcc ? (
            <button type="button" className="btn stop" disabled={busy} onClick={submitOccupied} autoFocus>
              {busy ? "저장 중…" : STAY_SALE_CTA}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn stop"
                disabled={busy}
                onClick={() => submitCreate(false)}
                autoFocus
              >
                {busy ? "저장 중…" : STAY_SALE_SAVE}
              </button>
              <button
                type="button"
                className="btn green"
                disabled={busy}
                onClick={() => submitCreate(true)}
                title="저장 후 바로 숙박(입실) · 이름·연락처 비우면 자동 표시명"
              >
                {busy ? "저장 중…" : STAY_SALE_CHECKIN}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
