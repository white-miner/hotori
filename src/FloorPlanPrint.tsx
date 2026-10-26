import { FileDown, Printer, X } from "lucide-react";
import { type HotelSettings, dayLabel } from "../shared/ledger";
import {
  FLOOR_PLAN_COPY,
  buildFloorPlanSections,
  floorPlanRoomCount,
} from "../shared/floorPlanPrint";

interface Props {
  hotelName: string;
  s: HotelSettings;
  today: string;
  onClose: () => void;
}

function runPrint(title: string) {
  const prevTitle = document.title;
  document.title = title;
  document.body.classList.add("print-floor-plan");
  let cleaned = false;
  const done = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove("print-floor-plan");
    document.title = prevTitle;
    window.removeEventListener("afterprint", done);
  };
  window.addEventListener("afterprint", done);
  window.print();
  window.setTimeout(done, 1500);
}

export default function FloorPlanPrint({ hotelName, s, today, onClose }: Props) {
  const sections = buildFloorPlanSections(s);
  const total = floorPlanRoomCount(sections);
  const trade = hotelName.trim() || "호텔";
  const fileTitle = `${trade}_${FLOOR_PLAN_COPY.title}_${today.replace(/-/g, "")}`;
  const printDoc = () => runPrint(fileTitle);

  return (
    <div className="dim floor-plan-dim" role="presentation" onClick={onClose}>
      <div
        className="modal floor-plan-print-modal"
        role="dialog"
        aria-labelledby="floor-plan-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mh noprint">
          <h2 id="floor-plan-title">{FLOOR_PLAN_COPY.title}</h2>
          <button type="button" className="x" onClick={onClose} aria-label={FLOOR_PLAN_COPY.close}>
            <X size={18} />
          </button>
        </div>

        {sections.length ? (
          <div className="floor-plan-print">
            <header className="fp-head">
              <div className="fp-hotel">{trade}</div>
              <h1 className="fp-title">{FLOOR_PLAN_COPY.title}</h1>
              <div className="fp-meta">
                {FLOOR_PLAN_COPY.roomCount(total)} · {dayLabel(today)}
              </div>
            </header>
            {sections.map((sec) => (
              <section className="fp-bld" key={sec.buildingId}>
                {sec.buildingLabel ? <h2 className="fp-bld-name">{sec.buildingLabel}</h2> : null}
                {sec.floors.map((f) => (
                  <div className="fp-floor" key={f.id}>
                    <div className="fp-flab">{f.name}</div>
                    <div className="fp-rooms">
                      {f.rooms.map((r) => (
                        <div className="fp-cell" key={r.id}>
                          <div className="fp-no">{r.no}</div>
                          {r.typeAbbr ? <div className="fp-type">{r.typeAbbr}</div> : <div className="fp-type muted">—</div>}
                          <div className="fp-note" aria-hidden />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </section>
            ))}
            <p className="fp-hint">{FLOOR_PLAN_COPY.noteHint}</p>
          </div>
        ) : (
          <p className="muted sm noprint" style={{ padding: "12px 16px" }}>
            {FLOOR_PLAN_COPY.empty}
          </p>
        )}

        <div className="mf noprint">
          <p className="fine">{FLOOR_PLAN_COPY.pdfHint}</p>
          <div className="keys acts">
            <button
              type="button"
              className="btn line sm"
              disabled={!sections.length}
              onClick={printDoc}
              aria-label={`${FLOOR_PLAN_COPY.title} ${FLOOR_PLAN_COPY.print}`}
            >
              <Printer size={14} /> {FLOOR_PLAN_COPY.print}
            </button>
            <button
              type="button"
              className="btn line sm"
              disabled={!sections.length}
              onClick={printDoc}
              title={FLOOR_PLAN_COPY.pdfHint}
              aria-label={`${FLOOR_PLAN_COPY.title} ${FLOOR_PLAN_COPY.pdf}`}
            >
              <FileDown size={14} /> {FLOOR_PLAN_COPY.pdf}
            </button>
          </div>
          <button type="button" className="btn" onClick={onClose}>
            {FLOOR_PLAN_COPY.close}
          </button>
        </div>
      </div>
    </div>
  );
}
