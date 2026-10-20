/**
 * 간단 예약 — Entry 축약 폼 (Path A: roomId=null · Path B: 지금 방 배정 · 확정 기본)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Minus, Plus } from "lucide-react";
import {
  type Booking,
  addDays,
  allRooms as placedRooms,
  freeRooms,
  legConflicts,
  md,
  previewChange,
  typeLabel,
  usableTypes,
  validateBooking,
  won,
} from "../shared/ledger";
import { syncStayNightRates } from "../shared/nightrates";
import { BOOK_PAY_LABEL, BOOK_PAY_METHODS, type BookPayMethod, isOnsite, validatePayment } from "../shared/payment";
import { GUESTS_MAX } from "../shared/surcharge";
import type { HotelData } from "./data";
import type { EntryRequest, ToastOpt } from "./App";
import { lookups } from "./ui";
import NightPickCalendar from "./NightPickCalendar";

type PayMode = "prepaid" | "postpaid" | "deposit";

interface Props {
  data: HotelData;
  today: string;
  req: EntryRequest;
  onClose: () => void;
  onSaved: (msg: string) => void;
  notify: (m: string, opt?: ToastOpt) => void;
  /** 풀 Entry로 열기 (상세·결제 보완) */
  onOpenFull?: (preset: Partial<Booking>) => void;
}

export default function SimpleBooking({ data, today, req, onClose, onSaved, notify, onOpenFull }: Props) {
  const s = data.hotel!.settings;
  const L = useMemo(() => lookups(s), [s]);
  const p = req.preset ?? {};
  const pickTypes = s.types.filter((t) => typeLabel(t));
  const [platformId, setPlatformId] = useState(p.platformId ?? s.platforms[0]?.id ?? "");
  const [typeId, setTypeId] = useState(p.typeId ?? usableTypes(s.types)[0]?.id ?? "");
  const [checkIn, setCheckIn] = useState(p.checkIn ?? today);
  const [nights, setNights] = useState(Math.max(1, p.nights ?? 1));
  const [guestName, setName] = useState("");
  const [guestPhone, setPhone] = useState("");
  const [guests, setGuests] = useState(1);
  const [rateStr, setRateStr] = useState("");
  const [priceStr, setPriceStr] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [priceUnset, setPriceUnset] = useState(false);
  const [assignNow, setAssignNow] = useState(false); // Path B
  const [roomId, setRoomId] = useState<string | null>(null);
  const [otherRooms, setOtherRooms] = useState(false);
  const [payMode, setPayMode] = useState<PayMode>("postpaid");
  const [depAmt, setDepAmt] = useState("");
  const [depMethod, setDepMethod] = useState<BookPayMethod>("card");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const stepGuests = (d: number) => {
    setGuests((g) => Math.max(1, Math.min(GUESTS_MAX, g + d)));
  };

  const plat = s.platforms.find((x) => x.id === platformId);
  const onsite = isOnsite(plat);
  const rate = Number(rateStr || 0);
  const suggested = !priceUnset && rate > 0 && nights > 0 ? rate * nights : 0;
  useEffect(() => {
    if (priceUnset || priceTouched) return;
    if (suggested > 0) setPriceStr(String(suggested));
    else setPriceStr("");
  }, [suggested, priceUnset, priceTouched]);

  const price = priceUnset ? 0 : Number(priceStr || 0);
  const draft: Booking = {
    id: "__simple__",
    kind: "stay",
    status: "active",
    platformId,
    price,
    priceUnset,
    guestName,
    guestPhone: guestPhone.trim() || null,
    typeId,
    roomId: assignNow ? roomId : null,
    segments: null,
    checkIn,
    nights,
    startTime: null,
    endTime: null,
    arrived: false,
    tentative: false,
    memo: null,
    guests,
    nightRates: !priceUnset && rate > 0 ? syncStayNightRates(checkIn, nights, { flat: rate }) : null,
    cancelledAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const free = useMemo(() => freeRooms(s, data.bookings, draft), [s, data.bookings, draft]);
  const allRooms = placedRooms(s);
  const sameType = allRooms.filter((r) => r.typeId === typeId && free.has(r.id));
  const otherType = allRooms.filter((r) => r.typeId !== typeId && free.has(r.id));
  const busyLegs = assignNow && roomId ? legConflicts(data.bookings, draft) : [];
  const preview = previewChange(s, data.bookings, draft);
  const typeOver = preview.some((r) => r.after < 0);

  async function save() {
    if (!guestName.trim()) return setErr("이름을 적어 주세요.");
    if (!guestPhone.trim()) return setErr("연락처를 적어 주세요.");
    if (!priceUnset && (!Number.isFinite(price) || price < 0 || (price === 0 && !rateStr && !priceStr)))
      return setErr("1박 요금·판매금을 적거나 금액미정을 켜 주세요.");
    if (assignNow && !roomId) return setErr("지금 배정하려면 호실을 골라 주세요.");
    if (onsite && payMode === "deposit" && !priceUnset) {
      const amt = Number(depAmt || 0);
      const pv = validatePayment(amt, depMethod, today);
      if (pv) return setErr(pv);
      if (amt > price) return setErr("선금이 판매금보다 커요.");
    }
    const v = validateBooking(draft, s);
    if (v) return setErr(v);
    if (busyLegs.length)
      return setErr(`${busyLegs.map((l) => `${L.roomLabel(l.roomId)}호`).join(", ")}는 그 기간에 다른 예약이 있어요.`);
    if (typeOver && !window.confirm("타입 재고가 모자랍니다(오버부킹). 그래도 저장할까요? · 물리 방 겹침은 막혀 있어요.")) return;

    setBusy(true);
    setErr(null);
    try {
      const saved = await data.saveBooking(draft, true);
      let payTail = "";
      if (onsite && !priceUnset && isOnsite(s.platforms.find((x) => x.id === saved.platformId))) {
        try {
          if (payMode === "prepaid" && saved.price > 0) {
            await data.addPayment(saved.id, { kind: "balance", method: depMethod, amount: saved.price, bizDate: today });
            payTail = ` · 선불(완납) ${won(saved.price)}원`;
          } else if (payMode === "deposit") {
            const amt = Number(depAmt || 0);
            if (amt > 0) {
              await data.addPayment(saved.id, { kind: "deposit", method: depMethod, amount: amt, bizDate: today });
              payTail = ` · 선금 ${won(amt)}원(${BOOK_PAY_LABEL[depMethod]})`;
            }
          }
        } catch (e) {
          payTail = ` · 결제는 적지 못했어요: ${e instanceof Error ? e.message : "다시 시도"}`;
        }
      }
      const path = saved.roomId ? ` · ${L.roomLabel(saved.roomId)}호` : " · 미배정(타입 재고)";
      const unset = saved.priceUnset ? " · 금액미정" : "";
      onSaved(`${saved.guestName} 님 간단 예약했어요${path}${unset}${payTail}`);
    } catch (e) {
      setErr(e instanceof Error ? `저장하지 못했어요: ${e.message}` : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  const bpre = (bid: string) => (L.multi ? <em className="bpre">{L.buildings.get(bid)?.name}</em> : null);

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal simple-book"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grab" />
        <div className="mh">
          <h2>간단 예약</h2>
          <span className="muted sm">전화·현장·OTA를 빠르게 · 호실은 지금 또는 나중에</span>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>

        <div className="fld simple-nights">
          <label>이용 날짜</label>
          <div>
            <NightPickCalendar
              checkIn={checkIn}
              nights={nights}
              bookings={data.bookings}
              roomId={assignNow ? roomId : null}
              today={today}
              onPick={(ci, n) => {
                setCheckIn(ci);
                setNights(n);
                setPriceTouched(false);
              }}
              onBlocked={() => notify("그 밤은 이미 다른 예약이 있어요")}
            />
            <div className="muted sm" style={{ marginTop: 6 }}>
              {md(checkIn)} 입실 · {nights}박 · {md(addDays(checkIn, nights))} 퇴실
            </div>
          </div>
        </div>

        <div className="fld">
          <label>채널</label>
          <div className="chips">
            {s.platforms.map((pl) => (
              <button
                type="button"
                key={pl.id}
                className={`chip ${pl.id === platformId ? "on" : ""}`}
                onClick={() => setPlatformId(pl.id)}
                title={isOnsite(pl) ? "현장/전화" : "플랫폼"}
              >
                {pl.name}
              </button>
            ))}
          </div>
        </div>

        <div className="simple-guest-row">
          <div className="fld">
            <label>
              이름<em>*</em>
            </label>
            <input ref={nameRef} value={guestName} onChange={(e) => setName(e.target.value)} placeholder="손님 이름" autoComplete="name" />
          </div>
          <div className="fld">
            <label>
              연락처<em>*</em>
            </label>
            <input
              value={guestPhone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="전화"
              inputMode="tel"
              autoComplete="tel"
            />
          </div>
        </div>

        <div className="fld">
          <label>객실타입</label>
          <div className="chips">
            {pickTypes.map((t) => (
              <button
                type="button"
                key={t.id}
                className={`chip ${t.id === typeId ? "on" : ""}`}
                onClick={() => {
                  setTypeId(t.id);
                  if (assignNow && roomId && L.rooms.get(roomId)?.typeId !== t.id) setRoomId(null);
                }}
              >
                {typeLabel(t)}
              </button>
            ))}
          </div>
        </div>

        <div className="fld">
          <label>인원</label>
          <div className="step gstep">
            <button type="button" className="sb" aria-label="1명 줄이기" onClick={() => stepGuests(-1)} disabled={guests <= 1}>
              <Minus size={16} />
            </button>
            <span className="sv">
              {guests}
              <small>명</small>
            </span>
            <button type="button" className="sb" aria-label="1명 늘리기" onClick={() => stepGuests(1)} disabled={guests >= GUESTS_MAX}>
              <Plus size={16} />
            </button>
          </div>
        </div>

        <div className="fld">
          <label>{onsite ? "요금" : "판매금"}</label>
          <div className="simple-price">
            <label className="ck">
              <input
                type="checkbox"
                checked={priceUnset}
                onChange={(e) => {
                  setPriceUnset(e.target.checked);
                  if (e.target.checked) {
                    setRateStr("");
                    setPriceStr("");
                    setPriceTouched(false);
                  }
                }}
              />
              금액미정
            </label>
            {!priceUnset ? (
              <div className="simple-price-row">
                <label className="inp price sm">
                  <span className="muted sm">1박</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    aria-label="1박 요금"
                    value={rateStr !== "" ? won(Number(rateStr)) : ""}
                    placeholder="0"
                    onChange={(e) => {
                      setRateStr(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setPriceTouched(false);
                    }}
                  />
                  원
                </label>
                <span className="muted sm">× {nights}박 →</span>
                <label className="inp price sm">
                  <span className="muted sm">{onsite ? "총액" : "판매금"}</span>
                  <input
                    className="num"
                    inputMode="numeric"
                    aria-label={onsite ? "총액" : "판매금"}
                    value={priceStr !== "" ? won(Number(priceStr)) : ""}
                    placeholder={suggested > 0 ? won(suggested) : "0"}
                    onChange={(e) => {
                      setPriceStr(e.target.value.replace(/\D/g, "").slice(0, 9));
                      setPriceTouched(true);
                    }}
                  />
                  원
                </label>
                {priceTouched && suggested > 0 && Number(priceStr || 0) !== suggested ? (
                  <button type="button" className="chip sm" onClick={() => { setPriceStr(String(suggested)); setPriceTouched(false); }}>
                    다시 맞추기
                  </button>
                ) : null}
              </div>
            ) : (
              <span className="muted sm">협상 후 Entry에서 확정</span>
            )}
          </div>
        </div>

        {onsite ? (
          <div className="fld">
            <label>결제</label>
            <div>
              <div className="chips">
                {(
                  [
                    ["prepaid", "선불"],
                    ["postpaid", "후불"],
                    ["deposit", "선금"],
                  ] as const
                ).map(([k, lab]) => (
                  <button type="button" key={k} className={`chip ${payMode === k ? "on" : ""}`} onClick={() => setPayMode(k)}>
                    {lab}
                  </button>
                ))}
              </div>
              {payMode === "prepaid" && !priceUnset ? (
                <div className="muted sm" style={{ marginTop: 6 }}>
                  저장 시 판매금만큼 받기(완납)로 적어요 · 방법
                  <span className="chips" style={{ display: "inline-flex", marginLeft: 8 }}>
                    {BOOK_PAY_METHODS.map((m) => (
                      <button type="button" key={m} className={`chip sm ${depMethod === m ? "on" : ""}`} onClick={() => setDepMethod(m)}>
                        {BOOK_PAY_LABEL[m]}
                      </button>
                    ))}
                  </span>
                </div>
              ) : null}
              {payMode === "deposit" && !priceUnset ? (
                <div className="simple-price-row" style={{ marginTop: 8 }}>
                  <label className="inp price sm">
                    <span className="muted sm">선금</span>
                    <input
                      className="num"
                      inputMode="numeric"
                      aria-label="선금"
                      value={depAmt !== "" ? won(Number(depAmt)) : ""}
                      onChange={(e) => setDepAmt(e.target.value.replace(/\D/g, "").slice(0, 9))}
                    />
                    원
                  </label>
                  <span className="chips">
                    {BOOK_PAY_METHODS.map((m) => (
                      <button type="button" key={m} className={`chip sm ${depMethod === m ? "on" : ""}`} onClick={() => setDepMethod(m)}>
                        {BOOK_PAY_LABEL[m]}
                      </button>
                    ))}
                  </span>
                </div>
              ) : null}
              {payMode === "postpaid" ? <div className="muted sm" style={{ marginTop: 6 }}>퇴실(또는 나중에) 정산 · 결제 줄 없음</div> : null}
              {priceUnset ? <div className="muted sm" style={{ marginTop: 6 }}>금액미정 · 수납은 확정 후 Entry에서</div> : null}
            </div>
          </div>
        ) : null}

        <div className="fld">
          <label>호실</label>
          <div>
            <label className="ck">
              <input
                type="checkbox"
                checked={assignNow}
                onChange={(e) => {
                  setAssignNow(e.target.checked);
                  if (!e.target.checked) setRoomId(null);
                }}
              />
              지금 방 배정
            </label>
            {assignNow ? (
              <div className="chips" style={{ marginTop: 8 }}>
                {sameType.map((r) => (
                  <button type="button" key={r.id} className={`rchip ${r.id === roomId ? "on" : ""}`} onClick={() => setRoomId(r.id)}>
                    {bpre(r.buildingId)}
                    {r.no}
                  </button>
                ))}
                {otherRooms || (roomId && L.rooms.get(roomId)?.typeId !== typeId)
                  ? otherType.map((r) => (
                      <button type="button" key={r.id} className={`rchip other ${r.id === roomId ? "on" : ""}`} onClick={() => setRoomId(r.id)}>
                        {bpre(r.buildingId)}
                        {r.no}
                        <i>{typeLabel(L.types.get(r.typeId ?? ""))}</i>
                      </button>
                    ))
                  : otherType.length ? (
                      <button type="button" className="rchip lt" onClick={() => setOtherRooms(true)}>
                        다른 타입 방 +{otherType.length}
                      </button>
                    ) : null}
                {!sameType.length && !otherRooms ? <span className="muted sm">이 타입은 그 기간에 빈 방이 없어요</span> : null}
              </div>
            ) : null}
          </div>
        </div>

        {err ? <div className="err">{err}</div> : null}

        <div className="mf">
          {onOpenFull ? (
            <button
              type="button"
              className="btn line"
              onClick={() =>
                onOpenFull({
                  kind: "stay",
                  checkIn,
                  nights,
                  platformId,
                  typeId,
                  roomId: assignNow ? roomId : null,
                  guestName: guestName || undefined,
                  guestPhone: guestPhone || undefined,
                  guests,
                  price: priceUnset ? undefined : price || undefined,
                })
              }
            >
              풀 Entry로
            </button>
          ) : null}
          <span className="grow" />
          <button type="button" className="btn line" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="btn dark" disabled={busy}>
            {busy ? "저장 중…" : assignNow ? "방까지 저장" : "간단 예약 저장"}
          </button>
        </div>
      </form>
    </div>
  );
}
