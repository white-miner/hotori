/**
 * 스마트등록 안의 양식 설정. 플랫폼마다 칸 이름만 고친다.
 * 저장은 이 브라우저의 이 호텔·이 직원 칸에만 둔다.
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  BUILTIN_TEMPLATES,
  PASTE_FIELD_LABELS,
  PASTE_TEMPLATE_FIELDS,
  type PastePlatformId,
  type PasteTemplate,
  type PasteTemplateField,
  extractLabeledPaste,
  validatePasteTemplate,
} from "../shared/pasteTemplate";
import { PLATFORM_PROFILES } from "../shared/smartRegister";
import { Chip, ChipGroup, Inp } from "./primitives";

interface Props {
  templates: readonly PasteTemplate[];
  canSave: boolean;
  onSave: (template: PasteTemplate) => void;
  onReset: (platformId: PastePlatformId) => void;
  onClose: () => void;
}

function labelsOf(platformId: PastePlatformId, templates: readonly PasteTemplate[]): Partial<Record<PasteTemplateField, string>> {
  return templates.find((t) => t.platformId === platformId)?.labels ?? BUILTIN_TEMPLATES[platformId]?.labels ?? {};
}

export default function PasteTemplatePanel({ templates, canSave, onSave, onReset, onClose }: Props) {
  const [platformId, setPlatformId] = useState<PastePlatformId>("agoda");
  const [draft, setDraft] = useState<Partial<Record<PasteTemplateField, string>>>(() => labelsOf("agoda", templates));
  const [sample, setSample] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    setDraft(labelsOf(platformId, templates));
  }, [platformId, templates]);

  const preview = useMemo(() => {
    if (!tried || !sample.trim()) return null;
    const v = validatePasteTemplate({ platformId, labels: draft });
    if (!v.ok) return null;
    return extractLabeledPaste(sample, v.template)[0] ?? null;
  }, [tried, sample, platformId, draft]);

  const pick = (id: PastePlatformId) => {
    setPlatformId(id);
    setDraft(labelsOf(id, templates));
    setErr(null);
    setTried(false);
  };

  const save = () => {
    const v = validatePasteTemplate({ platformId, labels: draft });
    if (!v.ok) {
      setErr(v.reason);
      return;
    }
    setErr(null);
    onSave(v.template);
  };

  return (
    <div className="dim assign-type-dim smart-reg-upload-dim" role="dialog" aria-modal="true" aria-labelledby="paste-template-title">
      <div className="modal paste-template-modal">
        <div className="mh">
          <h2 id="paste-template-title">양식 설정</h2>
          <button type="button" className="x" aria-label="닫기" onClick={onClose}>
            <X size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
        <p className="sub paste-template-note">
          이 브라우저에만 저장. 다른 기기나 다른 직원 화면에는 옮겨지지 않아요. 붙여넣은 손님 글은 양식으로 저장하지 않아요.
        </p>
        <ChipGroup scroll aria-label="플랫폼">
          {PLATFORM_PROFILES.map((p) => (
            <Chip key={p.id} sm active={platformId === p.id} onClick={() => pick(p.id)}>
              {p.label}
            </Chip>
          ))}
        </ChipGroup>
        <p className="sub">
          {platformId === "agoda"
            ? "아고다 기본 글자가 들어 있어요. 화면의 칸 이름만 고치면 됩니다."
            : "표로 복사하는 인식은 그대로예요. 여기 글자는 표가 아닌 붙여넣기에만 쓰여요."}
        </p>
        <div className="paste-template-fields">
          {PASTE_TEMPLATE_FIELDS.map((field) => (
            <label key={field}>
              <span>{PASTE_FIELD_LABELS[field]}</span>
              <Inp
                value={draft[field] ?? ""}
                maxLength={40}
                aria-label={PASTE_FIELD_LABELS[field]}
                placeholder="붙여넣은 글의 칸 이름"
                onChange={(e) => {
                  setDraft((d) => ({ ...d, [field]: e.target.value }));
                  setErr(null);
                }}
              />
            </label>
          ))}
        </div>
        <p className="sub">판매 총액은 예약의 판매 합계예요. 받은 돈이나 정산 글자는 넣을 수 없어요.</p>
        <label className="paste-template-sample">
          <span>시험 붙여넣기</span>
          <textarea
            className="inp smart-reg-ta"
            rows={5}
            value={sample}
            spellCheck={false}
            aria-label="시험 붙여넣기"
            placeholder="손님 글은 여기에만 두고, 저장되지 않아요."
            onChange={(e) => {
              setSample(e.target.value);
              setTried(false);
            }}
          />
        </label>
        <div className="paste-template-acts">
          <button type="button" className="btn line sm" onClick={() => setTried(true)} disabled={!sample.trim()}>
            추출 미리보기
          </button>
          <button type="button" className="btn line sm" onClick={() => onReset(platformId)}>
            기본값으로
          </button>
          <button type="button" className="btn dark sm" onClick={save} disabled={!canSave}>
            저장
          </button>
        </div>
        {!canSave ? <p className="sub">로그인한 뒤에만 이 브라우저에 저장할 수 있어요.</p> : null}
        {err ? <p className="err">{err}</p> : null}
        {preview ? (
          <dl className="paste-template-preview">
            <div><dt>예약번호</dt><dd>{preview.reservationId || "비움"}</dd></div>
            <div><dt>투숙객</dt><dd>{preview.guestName || "비움"}</dd></div>
            <div><dt>성인</dt><dd>{preview.adults ?? "비움"}</dd></div>
            <div><dt>체크인</dt><dd>{preview.checkIn ? `${preview.checkIn}${preview.checkInTime ? ` ${preview.checkInTime}` : ""}` : "비움"}</dd></div>
            <div><dt>체크아웃</dt><dd>{preview.checkOut ? `${preview.checkOut}${preview.checkOutTime ? ` ${preview.checkOutTime}` : ""}` : "비움"}</dd></div>
            <div><dt>박수</dt><dd>{preview.nights ?? "비움"}</dd></div>
            <div><dt>판매 총액</dt><dd>{preview.salesTotal != null ? `${preview.currency ?? ""} ${preview.salesTotal}`.trim() : "비움"}</dd></div>
            <div><dt>상태</dt><dd>{preview.statusRaw || "비움"}</dd></div>
            <div><dt>연락처</dt><dd>{preview.guestPhone || "비움"}</dd></div>
            <div><dt>객실 타입</dt><dd>{preview.typeRaw || "비움"}</dd></div>
            {preview.warnings.length ? <div><dt>확인</dt><dd>{preview.warnings.join(" · ")}</dd></div> : null}
          </dl>
        ) : null}
      </div>
    </div>
  );
}
