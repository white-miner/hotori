import { FileDown, Printer, X } from "lucide-react";
import {
  type Booking,
  type HotelSettings,
  checkOut,
  dayLabel,
  hotelBizDisplayName,
  md,
  roomLabel,
  typeLabel,
  STAY_CONFIRM_COPY,
} from "../shared/ledger";
import { lookups } from "./ui";

interface Props {
  booking: Booking;
  hotelName: string;
  s: HotelSettings;
  today: string;
  onClose: () => void;
}

function issueStamp(today: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const clock = `${p(d.getHours())}:${p(d.getMinutes())}`;
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
  const L = lookups(s);
  const biz = s.hotelBiz;
  const trade = hotelBizDisplayName(biz, hotelName);
  const nights = b.nights ?? 0;
  const out = checkOut(b);
  const plat = L.plats.get(b.platformId);
  const room = roomLabel(s, b.roomId);
  const type = typeLabel(s.types.find((t) => t.id === b.typeId));
  const ref = b.memo?.trim() || "";
  const issued = issueStamp(today);
  const fileTitle = `${trade}_${STAY_CONFIRM_COPY}_${b.guestName || "손님"}_${md(b.checkIn).replace("/", "")}`;

  const printDoc = () => runPrint(fileTitle);

  return (
    <div className="dim stay-confirm-dim" role="presentation" onClick={onClose}>
      <div
        className="modal stay-confirm"
        role="dialog"
        aria-labelledby="stay-confirm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh noprint">
          <h2 id="stay-confirm-title">{STAY_CONFIRM_COPY}</h2>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">
            <X size={18} />
          </button>
        </div>

        <div className="stay-confirm-print">
          <header className="sc-head">
            <div className="sc-hotel">
              <div className="sc-trade">{trade}</div>
              {biz.businessNumber ? <div>사업자번호 {biz.businessNumber}</div> : null}
              {biz.address ? <div>{biz.address}</div> : null}
              {biz.phone || biz.representative ? (
                <div>
                  {biz.phone ? `전화 ${biz.phone}` : null}
                  {biz.phone && biz.representative ? " · " : null}
                  {biz.representative ? `대표 ${biz.representative}` : null}
                </div>
              ) : null}
            </div>
            <h1 className="sc-title">{STAY_CONFIRM_COPY}</h1>
          </header>

          <dl className="sc-body">
            <div>
              <dt>투숙객</dt>
              <dd>
                {b.guestName}
                {b.guestPhone?.trim() ? ` · ${b.guestPhone.trim()}` : null}
              </dd>
            </div>
            <div>
              <dt>객실</dt>
              <dd>
                {room ? `${room}호` : "미배정"}
                {type ? ` · ${type}` : null}
              </dd>
            </div>
            <div>
              <dt>숙박기간</dt>
              <dd>
                {dayLabel(b.checkIn)} ~ {dayLabel(out)} · {nights}박
              </dd>
            </div>
            {plat || ref ? (
              <div>
                <dt>예약</dt>
                <dd>
                  {plat?.name ?? ""}
                  {plat && ref ? " · " : null}
                  {ref ? `예약번호 ${ref}` : null}
                </dd>
              </div>
            ) : null}
          </dl>

          <p className="sc-attest">위와 같이 숙박하였음을 확인합니다.</p>

          <div className="sc-issue">발급일 {issued}</div>

          <div className="sc-sign">
            <div className="sc-sign-trade">{trade}</div>
            <div className="sc-sign-rep">
              대표자 {biz.representative || "____________"}
              <span className="sc-seal">(인)</span>
            </div>
          </div>
        </div>

        <div className="mf noprint">
          <p className="fine">
            {biz.businessNumber || biz.address || biz.phone || biz.representative
              ? "설정에 저장한 사업자 정보가 인쇄됩니다."
              : "설정 → 호텔 사업자 정보를 넣으면 상호·사업자번호가 함께 인쇄됩니다."}
          </p>
          <div className="keys acts">
            <button type="button" className="btn line sm" onClick={printDoc} aria-label={`${STAY_CONFIRM_COPY} 인쇄`}>
              <Printer size={14} /> 인쇄
            </button>
            <button
              type="button"
              className="btn line sm"
              onClick={printDoc}
              title="인쇄 창에서「PDF로 저장」을 고르세요"
              aria-label={`${STAY_CONFIRM_COPY} PDF로 저장`}
            >
              <FileDown size={14} /> PDF
            </button>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
