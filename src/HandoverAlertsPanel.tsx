/** 탑바 Bell(특이사항) 패널: 목록 · 해결. 인수인계는 NoticesHubPanel 탭 */
import { useEffect, useMemo, useState } from "react";
import { Bell, X } from "lucide-react";
import { openForHandoff, type RoomMemo, type RoomMemoDraft, type RoomMemoStatus } from "../shared/roomMemo";
import type { HotelSettings } from "../shared/ledger";
import { lookups } from "./ui";

export type AlertStream = "issues" | "deliveries";

interface Props {
  stream: AlertStream;
  list: RoomMemo[];
  settings: HotelSettings;
  onClose: () => void;
  onSave: (d: RoomMemoDraft, id?: string) => Promise<RoomMemo>;
  onSetStatus: (id: string, status: RoomMemoStatus) => Promise<RoomMemo>;
  notify: (m: string) => void;
}

export default function HandoverAlertsPanel({ stream, list, settings, onClose, onSetStatus, notify }: Props) {
  const L = lookups(settings);
  const { issues } = useMemo(() => openForHandoff(list), [list]);
  const rows = stream === "issues" ? issues : [];
  const title = "특이사항";
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function resolve(m: RoomMemo) {
    setBusy(true);
    try {
      await onSetStatus(m.id, "resolved");
      notify("특이사항을 해결했어요");
    } catch (e) {
      notify(e instanceof Error ? e.message : "상태를 바꾸지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal handover-alerts-panel" role="dialog" aria-label={title}>
        <div className="grab" />
        <div className="mh">
          <h2>
            <Bell size={18} strokeWidth={2.2} aria-hidden />
            {title}
            {rows.length ? <span className="tag">{rows.length} 미해결</span> : null}
          </h2>
          <button type="button" className="x" onClick={onClose}>
            <X size={16} strokeWidth={2.2} aria-hidden />
            <kbd>Esc</kbd>닫기
          </button>
        </div>

        <p className="halert-hint muted">객실 칸 말풍선에서 특이사항을 남길 수 있어요</p>

        <div className="rmemo-list">
          {!rows.length ? <div className="lempty">미해결 특이사항이 없어요</div> : null}
          {rows.map((m) => {
            const label = m.roomId ? L.roomLabel(m.roomId) ?? m.roomId : null;
            return (
              <div key={m.id} className="rmemo-item">
                <div className="rmemo-main">
                  {label ? <span className="halert-room-tag">{label}</span> : <span className="halert-room-tag hotel">호텔</span>}
                  <span className="rmemo-body">{m.body}</span>
                </div>
                <div className="rmemo-acts">
                  <button type="button" className="btn sm line" disabled={busy} onClick={() => void resolve(m)}>
                    해결
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
