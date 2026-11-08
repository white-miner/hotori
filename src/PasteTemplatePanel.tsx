/**
 * 스마트등록 양식 설정.
 * 붙여넣은 글에서 값을 고르면, 그 값 위의 칸 이름만 호텔 계정에 저장한다.
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Platform } from "../shared/ledger";
import {
  PASTE_FIELD_LABELS,
  PASTE_TEMPLATE_FIELDS,
  type PasteTemplate,
  type PasteTemplateField,
  choiceFitsField,
  listPasteChoices,
  templateProfile,
  validatePasteTemplate,
} from "../shared/pasteTemplate";
import { Chip, ChipGroup } from "./primitives";

interface Props {
  platforms: Platform[];
  templates: readonly PasteTemplate[];
  sample: string;
  onSample: (text: string) => void;
  canSave: boolean;
  onSave: (template: PasteTemplate) => void;
  onReset: (platformId: string) => void;
  onClose: () => void;
}

function profileForName(name: string): PasteTemplate["profileId"] {
  const n = name.replace(/\s+/g, "").toLowerCase();
  if (n.includes("아고다") || n.includes("agoda")) return "agoda";
  if (n.includes("야놀자") || n.includes("yanolja")) return "yanolja";
  if (n.includes("여기어때") || n.includes("yeogi") || n.includes("goodchoice")) return "yeogi";
  if (n.includes("네이버") || n.includes("naver")) return "naver";
  return null;
}

export default function PasteTemplatePanel({ platforms, templates, sample, onSample, canSave, onSave, onReset, onClose }: Props) {
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? "");
  const [field, setField] = useState<PasteTemplateField>("guestName");
  const [draft, setDraft] = useState<PasteTemplate["labels"]>({});
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const saved = templates.find((t) => t.platformId === platformId);
    setDraft(saved?.labels ?? {});
    setErr(null);
  }, [platformId, templates]);

  const choices = useMemo(() => listPasteChoices(sample).filter((c) => choiceFitsField(field, c.value)), [sample, field]);
  const platform = platforms.find((p) => p.id === platformId);

  const pickPlatform = (id: string) => {
    setPlatformId(id);
    setField("guestName");
  };

  const pickValue = (label: string) => {
    if (field === "salesTotal") {
      const v = validatePasteTemplate({ platformId: platformId || "x", labels: { salesTotal: label } });
      if (!v.ok) {
        setErr(v.reason);
        return;
      }
    }
    setDraft((d) => ({ ...d, [field]: label }));
    setErr(null);
  };

  const save = () => {
    if (!platform) {
      setErr("설정에 플랫폼을 먼저 추가해 주세요.");
      return;
    }
    const profileId = profileForName(platform.name);
    const v = validatePasteTemplate({ platformId: platform.id, profileId, labels: draft });
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
        <p className="sub paste-template-note">호텔 계정에 저장해요. 다른 기기에서도 이 호텔은 같은 양식을 씁니다. 손님 글은 저장하지 않아요.</p>
        {platforms.length ? (
          <ChipGroup scroll aria-label="플랫폼">
            {platforms.map((p) => (
              <Chip key={p.id} sm active={platformId === p.id} onClick={() => pickPlatform(p.id)}>
                {p.name}
              </Chip>
            ))}
          </ChipGroup>
        ) : (
          <p className="err">설정에서 플랫폼을 추가한 뒤 양식을 저장할 수 있어요.</p>
        )}
        <label className="paste-template-sample">
          <span>예약 정보 붙여넣기</span>
          <textarea
            className="inp smart-reg-ta"
            rows={5}
            value={sample}
            spellCheck={false}
            aria-label="양식에 쓸 예약 정보"
            placeholder="플랫폼 예약 화면을 복사해서 여기에 붙여넣으세요."
            onChange={(e) => onSample(e.target.value)}
          />
        </label>
        <div className="paste-template-pick">
          <div>
            <p className="sub">앱 칸</p>
            <div className="paste-template-fields" role="listbox" aria-label="앱 칸">
              {PASTE_TEMPLATE_FIELDS.map((id) => (
                <button key={id} type="button" className={field === id ? "btn sm dark" : "btn sm line"} onClick={() => setField(id)}>
                  {PASTE_FIELD_LABELS[id]}
                  {draft[id] ? <small> · {draft[id]}</small> : null}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="sub">{PASTE_FIELD_LABELS[field]}에 넣을 값</p>
            {choices.length ? (
              <div className="paste-template-values">
                {choices.map((c) => (
                  <button key={`${c.label}\0${c.value}`} type="button" className={draft[field] === c.label ? "btn sm dark" : "btn sm line"} onClick={() => pickValue(c.label)}>
                    <b>{c.label}</b>
                    <span>{c.value}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="sub">이 칸에 맞는 값이 없어요. 글을 붙여넣거나 다른 칸을 고르세요.</p>
            )}
          </div>
        </div>
        <p className="sub">값을 고르면 그 위의 칸 이름만 기억합니다. 다음 예약의 다른 이름·번호도 같은 자리에서 읽어요.</p>
        {platform && templateProfile({ platformId: platform.id, profileId: profileForName(platform.name), version: 1, labels: draft }) === "agoda" ? (
          <p className="sub">아고다는 기본 글자도 함께 읽어요. 비운 칸은 기본 글자를 씁니다.</p>
        ) : null}
        <div className="paste-template-acts">
          <button type="button" className="btn line sm" onClick={() => platform && onReset(platform.id)} disabled={!platform}>
            이 플랫폼 지우기
          </button>
          <button type="button" className="btn dark sm" onClick={save} disabled={!canSave || !platform}>
            계정에 저장
          </button>
        </div>
        {!canSave ? <p className="sub">보기 전용이라 저장할 수 없어요.</p> : null}
        {err ? <p className="err">{err}</p> : null}
      </div>
    </div>
  );
}
