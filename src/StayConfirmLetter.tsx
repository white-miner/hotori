import { useMemo, useState } from "react";
import { FileDown, Printer, X } from "lucide-react";
import {
  type Booking,
  type HotelSettings,
  checkOut,
  dayLabel,
  hotelBizDisplayName,
  hotelBizUpjongUptaeLine,
  md,
  roomLabel,
  typeLabel,
  hotelBizHasAny,
  won,
} from "../shared/ledger";
import {
  type StayConfirmLang,
  stayConfirmDateRange,
  stayConfirmStrings,
} from "../shared/hotelBiz";
import { stayConfirmMoney } from "../shared/stayConfirmMoney";
import {
  formatIssuanceNightDate,
  issuanceNightCells,
  unitRateFromCells,
} from "../shared/issuanceNightDetail";
import IssuancePager, { ISS_PAGER_EN, ISS_PAGER_KO } from "./IssuancePager";
import { lookups } from "./ui";

interface Props {
  booking: Booking;
  hotelName: string;
  s: HotelSettings;
  today: string;
  onClose: () => void;
}

function issueStamp(lang: StayConfirmLang, today: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const clock = `${p(d.getHours())}:${p(d.getMinutes())}`;
  if (lang === "en") return `${today} ${clock}`;
  return `${dayLabel(today)} ${clock}`;
}

function runPrint(title: string) {
  const prevTitle = document.title;
  document.title = title;
  document.body.classList.add("print-stay-confirm");
  let cleaned = false;
  const done = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("print-stay-confirm");
    document.title = prevTitle;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  window.setTimeout(done, 1500);
}

export default function StayConfirmLetter({ booking: b, hotelName, s, today, onClose }: Props) {
  const [lang, setLang] = useState<StayConfirmLang>("ko");
  const [page, setPage] = useState(0);
  const t = stayConfirmStrings(lang);
  const L = lookups(s);
  const biz = s.hotelBiz;
  const trade = hotelBizDisplayName(biz, hotelName);
  const nights = b.nights ?? 0;
  const out = checkOut(b);
  const plat = L.plats.get(b.platformId);
  const room = roomLabel(s, b.roomId);
  const type = typeLabel(s.types.find((x) => x.id === b.typeId));
  const ref = b.memo?.trim() || "";
  const issued = issueStamp(lang, today);
  const guestPart = b.guestName || (lang === "en" ? "Guest" : "손님");
  const fileTitle = `${trade}_${t.title}_${guestPart}_${md(b.checkIn).replace("/", "")}`;
  const roomLine = room
    ? `${room}${t.roomSuffix}${type ? ` · ${type}` : ""}`
    : `${t.unassigned}${type ? ` · ${type}` : ""}`;
  const period = stayConfirmDateRange(lang, b.checkIn, out, nights, dayLabel);
  const hasBiz = hotelBizHasAny(biz);
  const money = stayConfirmMoney(b, plat);
  const moneyLine = money.unset
    ? t.amountUnset
    : [
        `${t.sale} ₩${won(money.sale)}`,
        money.showPaid ? `${t.paid} ₩${won(money.paid)}` : null,
        money.left != null ? `${t.balance} ₩${won(money.left)}` : null,
      ]
        .filter(Boolean)
        .join(" · ");

  const nightCells = useMemo(
    () =>
      money.unset || nights <= 0
        ? []
        : issuanceNightCells({
            checkIn: b.checkIn,
            nights,
            total: money.sale,
            nightRates: b.nightRates ?? null,
          }),
    [b.checkIn, b.nightRates, money.sale, money.unset, nights],
  );
  const unitRate = unitRateFromCells(nightCells, money.sale, nights);
  /** Long = multi-night detail → 2 slides (summary / night rates) */
  const longDoc = nightCells.length > 3;
  const pageCount = longDoc ? 2 : 1;

  const printDoc = () => runPrint(fileTitle);

  const head = (
    <header className="sc-head">
      <div className="sc-hotel">
        <div className="sc-trade">{trade}</div>
        {biz.businessNumber ? (
          <div>
            {t.bizNumber} {biz.businessNumber}
          </div>
        ) : null}
        {(() => {
          const uu = hotelBizUpjongUptaeLine(biz, { upjong: t.upjong, uptae: t.uptae });
          return uu ? <div>{uu}</div> : null;
        })()}
        {biz.address ? <div>{biz.address}</div> : null}
        {biz.phone || biz.representative ? (
          <div>
            {biz.phone ? `${t.phone} ${biz.phone}` : null}
            {biz.phone && biz.representative ? " · " : null}
            {biz.representative ? `${t.representativeShort} ${biz.representative}` : null}
          </div>
        ) : null}
      </div>
      <h1 className="sc-title">{t.title}</h1>
    </header>
  );

  const bodyDl = (
    <dl className="sc-body">
      <div>
        <dt>{t.guest}</dt>
        <dd>
          {b.guestName}
          {b.guestPhone?.trim() ? ` · ${b.guestPhone.trim()}` : null}
        </dd>
      </div>
      <div>
        <dt>{t.room}</dt>
        <dd>{roomLine}</dd>
      </div>
      <div>
        <dt>{t.stayPeriod}</dt>
        <dd>{period}</dd>
      </div>
      {plat || ref ? (
        <div>
          <dt>{t.reservation}</dt>
          <dd>
            {plat?.name ?? ""}
            {plat && ref ? " · " : null}
            {ref ? `${t.bookingNo} ${ref}` : null}
          </dd>
        </div>
      ) : null}
      <div>
        <dt>{t.amounts}</dt>
        <dd>
          {moneyLine}
          {!money.unset && nights > 1 && unitRate > 0 ? (
            <div className="muted sm">
              {lang === "en" ? "Per night" : "1박"} ₩{won(unitRate)}
            </div>
          ) : null}
        </dd>
      </div>
    </dl>
  );

  const nightBlock =
    nightCells.length > 1 ? (
      <div className="sc-night-detail">
        <div className="inv-pays-h">{lang === "en" ? "Nightly rates" : "날짜별 단가"}</div>
        <ul className="inv-night-list">
          {nightCells.map((c) => (
            <li key={c.date}>
              <span>{formatIssuanceNightDate(c.date, lang)}</span>
              <strong>₩{won(c.amount)}</strong>
            </li>
          ))}
        </ul>
      </div>
    ) : null;

  const foot = (
    <>
      <p className="sc-attest">{t.attest}</p>
      <div className="sc-issue">
        {t.issued} {issued}
      </div>
      <div className="sc-sign">
        <div className="sc-sign-trade">{trade}</div>
        <div className="sc-sign-rep">
          {t.representative} {biz.representative || "____________"}
          <span className="sc-seal">{t.seal}</span>
        </div>
      </div>
    </>
  );

  return (
    <div className="dim stay-confirm-dim" role="presentation" onClick={onClose}>
      <div
        className="modal stay-confirm"
        role="dialog"
        aria-labelledby="stay-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh noprint">
          <h2 id="stay-confirm-title">{t.title}</h2>
          <div className="seg sm sc-lang" role="tablist" aria-label={t.langAria}>
            <button
              type="button"
              role="tab"
              aria-selected={lang === "ko"}
              className={lang === "ko" ? "on" : ""}
              onClick={() => setLang("ko")}
            >
              {t.langKo}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={lang === "en"}
              className={lang === "en" ? "on" : ""}
              onClick={() => setLang("en")}
            >
              {t.langEn}
            </button>
          </div>
          <button type="button" className="x" onClick={onClose} aria-label={t.close}>
            <X size={18} />
          </button>
        </div>

        <div className={`stay-confirm-slide noprint${lang === "en" ? " en" : ""}`}>
          {page === 0 ? (
            <>
              {head}
              {bodyDl}
              {!longDoc ? nightBlock : null}
              {foot}
            </>
          ) : (
            <>
              <div className="iss-slide-cont muted sm">
                {t.title} · {lang === "en" ? "Nightly rates" : "날짜별 단가"}
              </div>
              {nightBlock}
              {foot}
            </>
          )}
        </div>

        <div className={`stay-confirm-print iss-print-src${lang === "en" ? " en" : ""}`} aria-hidden>
          {head}
          {bodyDl}
          {nightBlock}
          {foot}
        </div>

        <div className="mf noprint stay-confirm-foot">
          <IssuancePager
            page={page}
            pageCount={pageCount}
            onChange={setPage}
            labels={lang === "en" ? ISS_PAGER_EN : ISS_PAGER_KO}
          />
          <p className="fine">{hasBiz ? t.tipFilled : t.tipEmpty}</p>
          <div className="keys acts">
            <button type="button" className="btn line sm" onClick={printDoc} aria-label={`${t.title} ${t.print}`}>
              <Printer size={14} /> {t.print}
            </button>
            <button
              type="button"
              className="btn line sm"
              onClick={printDoc}
              title={t.pdfHint}
              aria-label={`${t.title} ${t.pdf}`}
            >
              <FileDown size={14} /> {t.pdf}
            </button>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            {t.close}
          </button>
        </div>
      </div>
    </div>
  );
}
