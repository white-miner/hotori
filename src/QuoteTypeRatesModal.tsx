import { useRef, useState } from "react";
import { typeLabel, usableTypes, type HotelSettings } from "../shared/ledger";
import { RATE_MAX } from "../shared/seasonRates";
import NumInput from "./NumInput";

type Props = {
  settings: HotelSettings;
  onSave: (changes: Record<string, number | null>) => Promise<void>;
  onClose: () => void;
};

export default function QuoteTypeRatesModal({ settings, onSave, onClose }: Props) {
  const [rates, setRates] = useState(() => ({ ...settings.quoteTypeRates }));
  const originalRates = useRef({ ...settings.quoteTypeRates });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const types = usableTypes(settings.types);
  const save = async () => {
    if (pending.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const changes: Record<string, number | null> = {};
      for (const { id } of types) {
        if (rates[id] !== originalRates.current[id]) changes[id] = rates[id] ?? null;
      }
      if (Object.keys(changes).length) await onSave(changes);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "요금을 저장하지 못했어요. 연결을 확인한 뒤 다시 저장해 주세요.");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return <div className="dim quote-overlay">
    <section className="modal iss-rates-modal quote-only-rates" role="dialog" aria-modal="true" aria-labelledby="quote-type-rates-title">
      <div className="mh">
        <h2 id="quote-type-rates-title">견적서 타입별 요금 설정</h2>
        <button type="button" className="x" aria-label="닫기" disabled={saving} onClick={onClose}>×</button>
      </div>
      <p className="quote-rate-explain">객실 1실의 1박 단가를 입력하세요. 견적 객실 내역에 자동으로 채워져요.</p>
      <div className="iss-rates-body">
        <table className="quote-type-rates-table">
          <thead><tr><th scope="col">객실 타입</th><th scope="col">견적 단가 (원)</th></tr></thead>
          <tbody>{types.map((type) => <tr key={type.id}>
            <th scope="row">{typeLabel(type)}</th>
            <td><NumInput aria-label={`${typeLabel(type)} 견적 단가`} value={rates[type.id]} allowEmpty min={0} max={RATE_MAX}
              placeholder="미설정" onChange={(value) => setRates((current) => {
                const next = { ...current };
                if (value) next[type.id] = value;
                else delete next[type.id];
                return next;
              })} /></td>
          </tr>)}</tbody>
        </table>
      </div>
      {error && <p className="warn" role="alert">{error}</p>}
      <div className="mf">
        <button type="button" className="btn line" disabled={saving} onClick={onClose}>취소</button>
        <button type="button" className="btn dark" disabled={saving || !types.length} onClick={() => void save()}>
          {saving ? "저장 중…" : "저장하고 견적에 적용"}
        </button>
      </div>
    </section>
  </div>;
}
