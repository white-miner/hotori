type BookingMode = "simple" | "detail";

type Props = {
  mode: BookingMode;
  /** switch to 간단 (Entry → SimpleBooking) */
  onSimple?: () => void;
  /** switch to 상세 (SimpleBooking → Entry) */
  onDetail?: () => void;
};

/**
 * Progressive disclosure cue — same booking shell, 간단 | 상세.
 * Does not invent a second form system; only hops between existing modals.
 */
export function BookingModeSeg({ mode, onSimple, onDetail }: Props) {
  return (
    <div className="seg sm book-mode" role="tablist" aria-label="예약 모드">
      <button
        type="button"
        role="tab"
        aria-selected={mode === "simple"}
        className={mode === "simple" ? "on" : ""}
        onClick={onSimple}
        disabled={mode === "simple" || !onSimple}
      >
        간단
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === "detail"}
        className={mode === "detail" ? "on" : ""}
        onClick={onDetail}
        disabled={mode === "detail" || !onDetail}
      >
        상세
      </button>
    </div>
  );
}
