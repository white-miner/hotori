/**
 * 스마트등록 양식 설정.
 * 붙여넣은 글에서 값을 고르면, 그 값 위의 칸 이름만 호텔 계정에 저장한다.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Platform } from "../shared/ledger";
import {
  type PasteFieldRule,
  type PasteTemplate,
  type PasteTemplateField,
  choiceFitsField,
  readFieldValue,
  lineIndexForSelection,
  readPasteLines,
  ruleForPickedLine,
  templateProfile,
  validatePasteTemplate,
} from "../shared/pasteTemplate";
import { SMART_REGISTER_TEMPLATE_COLUMNS, type SmartRegisterTemplateColumnId } from "../shared/smartRegister";
import { Chip, ChipGroup } from "./primitives";

interface Props {
  platforms: Platform[];
  sample: string;
  onSample: (text: string) => void;
  drafts: Readonly<Record<string, { labels: PasteTemplate["labels"]; rules: NonNullable<PasteTemplate["rules"]> }>>;
  onEdit: (platformId: string, field: PasteTemplateField, rule: PasteFieldRule) => void;
  canSave: boolean;
  onSave: (template: PasteTemplate) => void;
  onReset: (platformId: string) => void;
  onClose: () => void;
}

function templateFieldOf(id: SmartRegisterTemplateColumnId): PasteTemplateField {
  return id === "amount" ? "salesTotal" : id;
}

function profileForName(name: string): PasteTemplate["profileId"] {
  const n = name.replace(/\s+/g, "").toLowerCase();
  if (n.includes("아고다") || n.includes("agoda")) return "agoda";
  if (n.includes("야놀자") || n.includes("yanolja")) return "yanolja";
  if (n.includes("여기어때") || n.includes("yeogi") || n.includes("goodchoice")) return "yeogi";
  if (n.includes("네이버") || n.includes("naver")) return "naver";
  return null;
}

export default function PasteTemplatePanel({ platforms, sample, onSample, drafts, onEdit, canSave, onSave, onReset, onClose }: Props) {
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? "");
  const [field, setField] = useState<PasteTemplateField>("guestName");
  const [pickedLine, setPickedLine] = useState<Partial<Record<PasteTemplateField, number>>>({});
  const [err, setErr] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const rememberSelection = () => {
    const area = areaRef.current;
    if (!area || area.selectionStart === area.selectionEnd) return;
    selectionRef.current = { start: area.selectionStart, end: area.selectionEnd };
  };
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    const remember = () => rememberSelection();
    area.addEventListener("select", remember);
    area.addEventListener("keyup", remember);
    area.addEventListener("mouseup", remember);
    return () => {
      area.removeEventListener("select", remember);
      area.removeEventListener("keyup", remember);
      area.removeEventListener("mouseup", remember);
    };
  }, [sample]);
  const draft = drafts[platformId] ?? { labels: {}, rules: {} };

  const pickPlatform = (id: string) => {
    setPlatformId(id);
    setField("guestName");
    setPickedLine({});
    setErr(null);
  };

  const lines = useMemo(() => readPasteLines(sample), [sample]);
  const readFor = (id: PasteTemplateField) => {
    const rule = draft.rules[id];
    const label = rule?.label ?? draft.labels[id];
    return label ? readFieldValue(sample, id, label, rule?.occurrence ?? 0) : "";
  };
  const readValue = readFor(field);
  const platform = platforms.find((p) => p.id === platformId);

  const pickLine = (index: number, forField: PasteTemplateField = field) => {
    selectionRef.current = null;
    const rule = ruleForPickedLine(lines, index, forField);
    if (!rule) {
      setField(forField);
      setErr("이 줄 위에 칸 이름이 없어요. 값 바로 위 줄을 칸 이름으로 읽을 수 없습니다.");
      return;
    }
    setField(forField);
    setPickedLine((prev) => ({ ...prev, [forField]: index }));
    if (forField === "salesTotal") {
      const v = validatePasteTemplate({ platformId: platformId || "x", labels: { salesTotal: rule.label }, rules: { salesTotal: rule } });
      if (!v.ok) {
        setErr(v.reason);
        return;
      }
    }
    if (platformId) onEdit(platformId, forField, rule);
    setErr(null);
  };

  const bindSelection = (forField: PasteTemplateField) => {
    const area = areaRef.current;
    const live = area && area.selectionStart !== area.selectionEnd ? { start: area.selectionStart, end: area.selectionEnd } : null;
    const sel = live ?? selectionRef.current;
    selectionRef.current = null;
    if (!sel || !area) return;
    const idx = lineIndexForSelection(lines, sel.start, sel.end);
    if (idx >= 0) pickLine(idx, forField);
    if (live) area.setSelectionRange(sel.end, sel.end);
  };

  const save = () => {
    if (!platform) {
      setErr("설정에 플랫폼을 먼저 추가해 주세요.");
      return;
    }
    const profileId = profileForName(platform.name);
    const v = validatePasteTemplate({ platformId: platform.id, profileId, labels: draft.labels, rules: draft.rules });
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
            ref={areaRef}
            aria-label="양식에 쓸 예약 정보"
            placeholder="플랫폼 예약 화면을 복사해서 여기에 붙여넣으세요. 줄을 고르거나, 글자를 선택한 뒤 왼쪽 칸을 누르세요."
            onChange={(e) => {
              selectionRef.current = null;
              onSample(e.target.value);
            }}
            onSelect={rememberSelection}
            onKeyUp={rememberSelection}
            onMouseUp={rememberSelection}
          />
        </label>
        <div className="paste-template-pick">
          <div>
            <p className="sub">앱 칸</p>
            <div className="paste-template-fields" role="listbox" aria-label="앱 칸">
              {SMART_REGISTER_TEMPLATE_COLUMNS.map((col) => {
                const id = templateFieldOf(col.id);
                const shown = readFor(id);
                return (
                  <button
                    key={col.id}
                    type="button"
                    data-field={id}
                    className={field === id ? "btn sm dark" : "btn sm line"}
                    onMouseDown={() => bindSelection(id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") bindSelection(id);
                    }}
                    onClick={() => setField(id)}
                    title={col.id === "adults" ? "원문의 성인 수. 예약 인원으로 저장됩니다" : undefined}
                  >
                    {col.label}
                    {shown ? <small> · {shown}</small> : draft.labels[id] ? <small> · {draft.labels[id]}{draft.rules[id]?.occurrence ? ` · ${draft.rules[id]!.occurrence + 1}번째` : ""}</small> : null}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className="sub">{SMART_REGISTER_TEMPLATE_COLUMNS.find((col) => templateFieldOf(col.id) === field)?.label} · 붙여넣은 글 {lines.length}줄{readValue ? ` · 읽힘 ${readValue}` : ""}</p>
            {lines.length ? (
              <div className="paste-template-values">
                {lines.map((line, i) => {
                  const selected = pickedLine[field] === i || (pickedLine[field] == null && draft.labels[field] === line.label && (draft.rules[field]?.occurrence ?? 0) === 0 && choiceFitsField(field, line.text));
                  return (
                    <button key={`${i}\0${line.text}`} type="button" className={selected ? "btn sm dark" : "btn sm line"} onClick={() => pickLine(i)}>
                      <b>{line.text}</b>
                      <span>{line.label === line.text ? "칸 이름" : `이 값의 칸 이름 ${line.label}`}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="sub">아직 읽은 글이 없어요. 위에 예약 정보를 붙여넣으세요.</p>
            )}
          </div>
        </div>
        <p className="sub">스마트등록이 읽는 항목입니다. 인원은 원문의 성인 수이고 예약 인원으로 저장됩니다. 입실·퇴실 시각은 요금으로 바꾸지 않아요. 줄을 고르면 칸 이름만 기억하고, 이름·예약번호·금액·인원은 양식에 저장하지 않아요. 확정된 예약은 결제가 아니고 판매금은 수납이 아닙니다.</p>
        {platform && templateProfile({ platformId: platform.id, profileId: profileForName(platform.name), version: 1, labels: draft.labels, rules: draft.rules }) === "agoda" ? (
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
