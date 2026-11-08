import { Trash2, X } from "lucide-react";
import {
  PASTE_FIELD_LABELS,
  PASTE_TEMPLATE_FIELDS,
  type PasteTemplate,
  type PasteTemplateField,
} from "../shared/pasteTemplate";

interface Props {
  platforms: readonly { id: string; name: string }[];
  templates: readonly PasteTemplate[];
  canEdit: boolean;
  onForget: (platformId: string, field: PasteTemplateField) => void;
  onClose: () => void;
}

/** 미리보기에서 고른 칸 이름 목록. 잘못 배운 칸 이름은 여기서 지운다. 손님 값은 없다. */
export default function LearnedLabelsPanel({ platforms, templates, canEdit, onForget, onClose }: Props) {
  const nameOf = (id: string) => platforms.find((p) => p.id === id)?.name ?? id;
  const groups = templates
    .map((t) => ({
      platformId: t.platformId,
      rows: PASTE_TEMPLATE_FIELDS.flatMap((field) => {
        const label = t.rules?.[field]?.label ?? t.labels[field];
        if (!label) return [];
        return [{ field, label, occurrence: t.rules?.[field]?.occurrence ?? 0 }];
      }),
    }))
    .filter((g) => g.rows.length);
  return (
    <div className="dim" role="dialog" aria-modal="true" aria-labelledby="learned-labels-title">
      <div className="modal learned-labels-modal">
        <div className="mh">
          <h2 id="learned-labels-title">배운 칸 이름</h2>
          <button type="button" className="x" aria-label="닫기" onClick={onClose}>
            <X size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </div>
        <div className="mb">
          <p className="sub learned-labels-note">
            미리보기에서 「원문에서 고르기」로 고른 칸 이름이에요. 모든 플랫폼 글을 읽을 때 같이 써요. 잘못 배운 것은 지우세요.
          </p>
          {groups.length ? (
            groups.map((g) => (
              <section key={g.platformId} className="learned-labels-group" aria-label={nameOf(g.platformId)}>
                <h3>{nameOf(g.platformId)}</h3>
                {g.rows.map((r) => (
                  <div key={r.field} className="learned-labels-row" data-learned={`${g.platformId}:${r.field}`}>
                    <span className="learned-labels-field">{PASTE_FIELD_LABELS[r.field]}</span>
                    <span className="learned-labels-label">
                      {r.label}
                      {r.occurrence > 0 ? ` · ${r.occurrence + 1}번째` : ""}
                    </span>
                    {canEdit ? (
                      <button
                        type="button"
                        className="ic"
                        aria-label={`${PASTE_FIELD_LABELS[r.field]} 칸 이름 지우기`}
                        onClick={() => onForget(g.platformId, r.field)}
                      >
                        <Trash2 size={14} strokeWidth={2.2} aria-hidden />
                      </button>
                    ) : null}
                  </div>
                ))}
              </section>
            ))
          ) : (
            <p className="sub">아직 배운 칸 이름이 없어요.</p>
          )}
        </div>
      </div>
    </div>
  );
}
