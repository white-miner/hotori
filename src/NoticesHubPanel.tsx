/** 탑바 공지 허브: 탭 공지 | 인수인계 · Threads식 피드 · 수정/삭제만 로그인 비밀번호 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList, X } from "lucide-react";
import {
  HOTEL_NOTICE_BODY_MAX,
  HOTEL_NOTICE_STATUS_LABEL,
  noticeRelativeTime,
  noticeWasEdited,
  sortNoticeFeed,
  type HotelNotice,
  type HotelNoticeDraft,
  type HotelNoticeStatus,
  validateHotelNoticeDraft,
} from "../shared/hotelNotice";
import {
  ROOM_MEMO_BODY_MAX,
  ROOM_MEMO_KIND_LABEL,
  openForHandoff,
  type RoomMemo,
  type RoomMemoDraft,
  type RoomMemoStatus,
  validateRoomMemoDraft,
} from "../shared/roomMemo";
import { allRooms, type HotelSettings } from "../shared/ledger";
import { supabase } from "./supabase";
import { lookups } from "./ui";

export type NoticesHubTab = "notices" | "deliveries";

interface Props {
  tab: NoticesHubTab;
  onTab: (t: NoticesHubTab) => void;
  notices: HotelNotice[];
  memos: RoomMemo[];
  settings: HotelSettings;
  email: string;
  onClose: () => void;
  onSaveNotice: (d: HotelNoticeDraft, id?: string) => Promise<HotelNotice>;
  onSetNoticeStatus: (id: string, status: HotelNoticeStatus) => Promise<HotelNotice>;
  onRemoveNotice: (id: string) => Promise<void>;
  onAckNotice: (id: string) => Promise<void>;
  onSaveMemo: (d: RoomMemoDraft, id?: string) => Promise<RoomMemo>;
  onSetMemoStatus: (id: string, status: RoomMemoStatus) => Promise<RoomMemo>;
  notify: (m: string) => void;
}

type PwGate = { kind: "edit"; notice: HotelNotice } | { kind: "delete"; notice: HotelNotice } | null;

async function verifyLoginPassword(email: string, password: string): Promise<string | null> {
  const pw = password.trim();
  if (!pw) return "비밀번호를 입력해 주세요";
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
  if (error) return "비밀번호가 맞지 않아요";
  return null;
}

export default function NoticesHubPanel({
  tab,
  onTab,
  notices,
  memos,
  settings,
  email,
  onClose,
  onSaveNotice,
  onSetNoticeStatus,
  onRemoveNotice,
  onAckNotice,
  onSaveMemo,
  onSetMemoStatus,
  notify,
}: Props) {
  const L = lookups(settings);
  const { deliveries } = useMemo(() => openForHandoff(memos), [memos]);
  const [includeResolved, setIncludeResolved] = useState(false);
  const feed = useMemo(() => sortNoticeFeed(notices, includeResolved), [notices, includeResolved]);
  const openNoticeN = useMemo(
    () => notices.filter((x) => x.status === "open" || x.status === "in_progress").length,
    [notices],
  );
  const [busy, setBusy] = useState(false);
  const [body, setBody] = useState("");
  const [roomId, setRoomId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pwGate, setPwGate] = useState<PwGate>(null);
  const [pw, setPw] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);
  const noticeInputRef = useRef<HTMLTextAreaElement>(null);
  const deliveryInputRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const rooms = useMemo(() => allRooms(settings), [settings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (pwGate) {
        setPwGate(null);
        setPw("");
        setPwErr(null);
        return;
      }
      if (composing || editingId) {
        setComposing(false);
        setEditingId(null);
        setBody("");
        setRoomId("");
        setErr(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, composing, editingId, pwGate]);

  useEffect(() => {
    if (!(composing || editingId)) return;
    if (tab === "notices") noticeInputRef.current?.focus();
    else deliveryInputRef.current?.focus();
  }, [composing, editingId, tab]);

  useEffect(() => {
    if (pwGate) {
      setPw("");
      setPwErr(null);
      setTimeout(() => pwRef.current?.focus(), 0);
    }
  }, [pwGate]);

  async function submitNotice() {
    const d: HotelNoticeDraft = { body, status: editingId ? undefined : "open" };
    const v = validateHotelNoticeDraft(d);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      if (editingId) {
        await onSaveNotice({ body }, editingId);
        notify("공지를 수정했어요");
      } else {
        await onSaveNotice(d);
        notify("공지를 올렸어요");
      }
      setBody("");
      setComposing(false);
      setEditingId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function submitDelivery() {
    const d: RoomMemoDraft = { body, kind: "delivery", roomId: roomId || null, status: "open" };
    const v = validateRoomMemoDraft(d);
    if (v) return setErr(v);
    setBusy(true);
    setErr(null);
    try {
      await onSaveMemo(d);
      notify("전달사항을 남겼어요");
      setBody("");
      setRoomId("");
      setComposing(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function resolveDelivery(m: RoomMemo) {
    setBusy(true);
    try {
      await onSetMemoStatus(m.id, "resolved");
      notify("인수인계를 확인했어요");
    } catch (e) {
      notify(e instanceof Error ? e.message : "상태를 바꾸지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function setNoticeStatus(n: HotelNotice, status: HotelNoticeStatus) {
    setBusy(true);
    try {
      await onSetNoticeStatus(n.id, status);
      notify(status === "resolved" ? "공지를 해결했어요" : status === "in_progress" ? "진행중으로 바꿨어요" : "미해결로 바꿨어요");
    } catch (e) {
      notify(e instanceof Error ? e.message : "상태를 바꾸지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function ackNotice(n: HotelNotice) {
    setBusy(true);
    try {
      await onAckNotice(n.id);
      notify("확인했어요");
    } catch (e) {
      notify(e instanceof Error ? e.message : "확인하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  async function confirmPw() {
    setBusy(true);
    setPwErr(null);
    try {
      const fail = await verifyLoginPassword(email, pw);
      if (fail) {
        setPwErr(fail);
        return;
      }
      if (!pwGate) return;
      if (pwGate.kind === "delete") {
        await onRemoveNotice(pwGate.notice.id);
        notify("공지를 삭제했어요");
      } else {
        setEditingId(pwGate.notice.id);
        setBody(pwGate.notice.body);
        setComposing(true);
        setErr(null);
      }
      setPwGate(null);
      setPw("");
    } catch (e) {
      setPwErr(e instanceof Error ? e.message : "확인하지 못했어요");
    } finally {
      setBusy(false);
    }
  }

  const title = "공지";

  return (
    <div className="dim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal handover-alerts-panel notices-hub-panel" role="dialog" aria-label={title}>
        <div className="grab" />
        <div className="mh">
          <h2>
            <ClipboardList size={18} strokeWidth={2.2} aria-hidden />
            {title}
            {openNoticeN ? <span className="tag">{openNoticeN} 미해결</span> : null}
          </h2>
          <button type="button" className="x" onClick={onClose}>
            <X size={16} strokeWidth={2.2} aria-hidden />
            <kbd>Esc</kbd>닫기
          </button>
        </div>

        <div className="seg notices-hub-tabs" role="tablist" aria-label="공지·인수인계">
          <button type="button" role="tab" className={tab === "notices" ? "on" : ""} aria-selected={tab === "notices"} onClick={() => onTab("notices")}>
            공지
            {openNoticeN ? <span className="notices-tab-n">{openNoticeN}</span> : null}
          </button>
          <button type="button" role="tab" className={tab === "deliveries" ? "on" : ""} aria-selected={tab === "deliveries"} onClick={() => onTab("deliveries")}>
            인수인계
            {deliveries.length ? <span className="notices-tab-n">{deliveries.length}</span> : null}
          </button>
        </div>

        {tab === "notices" ? (
          <>
            <div className="halert-create">
              {!composing ? (
                <div className="notices-toolbar">
                  <button type="button" className="btn line sm" onClick={() => { setComposing(true); setEditingId(null); setBody(""); setErr(null); }}>
                    + 공지
                  </button>
                  <label className="notices-resolved-toggle">
                    <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
                    해결 포함
                  </label>
                </div>
              ) : (
                <form
                  className="rmemo-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitNotice();
                  }}
                >
                  <textarea
                    ref={noticeInputRef}
                    className="inp notices-compose"
                    value={body}
                    maxLength={HOTEL_NOTICE_BODY_MAX}
                    rows={3}
                    placeholder="예: 겨울 대비 난방 확인 · 엘리베이터 점검 14–16시"
                    aria-label={editingId ? "공지 수정" : "공지 내용"}
                    onChange={(e) => setBody(e.target.value.slice(0, HOTEL_NOTICE_BODY_MAX))}
                  />
                  <div className="rmemo-row">
                    <span className="muted notices-len">{body.trim().length}/{HOTEL_NOTICE_BODY_MAX}</span>
                    <button type="submit" className="btn red sm" disabled={busy}>
                      {busy ? "…" : editingId ? "수정" : "올리기"}
                    </button>
                    <button
                      type="button"
                      className="btn line sm"
                      disabled={busy}
                      onClick={() => {
                        setComposing(false);
                        setEditingId(null);
                        setBody("");
                        setErr(null);
                      }}
                    >
                      취소
                    </button>
                  </div>
                  {err ? <div className="ferr">{err}</div> : null}
                </form>
              )}
            </div>

            <div className="rmemo-list notices-feed">
              {!feed.length ? <div className="lempty">공지가 없어요</div> : null}
              {feed.map((n) => (
                <div key={n.id} className={`rmemo-item notice-row${n.status === "resolved" ? " done" : ""}`}>
                  <div className="notice-meta">
                    <span className={`notice-st s-${n.status}`}>{HOTEL_NOTICE_STATUS_LABEL[n.status]}</span>
                    <span className="notice-time muted">{noticeRelativeTime(n.createdAt)}</span>
                    {noticeWasEdited(n) ? <span className="muted">· 수정됨</span> : null}
                    {(n.ackCount ?? 0) > 0 ? <span className="muted">· 확인 {n.ackCount}</span> : null}
                  </div>
                  <div className="rmemo-main">
                    <span className="rmemo-body notice-body">{n.body}</span>
                  </div>
                  <div className="rmemo-acts">
                    {n.status !== "in_progress" && n.status !== "resolved" ? (
                      <button type="button" className="btn sm line" disabled={busy} onClick={() => void setNoticeStatus(n, "in_progress")}>
                        진행중
                      </button>
                    ) : null}
                    {n.status !== "resolved" ? (
                      <button type="button" className="btn sm line" disabled={busy} onClick={() => void setNoticeStatus(n, "resolved")}>
                        해결
                      </button>
                    ) : (
                      <button type="button" className="btn sm line" disabled={busy} onClick={() => void setNoticeStatus(n, "open")}>
                        미해결
                      </button>
                    )}
                    {!n.ackedAt && n.status !== "resolved" ? (
                      <button type="button" className="btn sm line" disabled={busy} onClick={() => void ackNotice(n)}>
                        확인
                      </button>
                    ) : n.ackedAt ? (
                      <span className="muted notice-acked">확인함</span>
                    ) : null}
                    <button type="button" className="btn sm line" disabled={busy} onClick={() => setPwGate({ kind: "edit", notice: n })}>
                      수정
                    </button>
                    <button type="button" className="btn sm line" disabled={busy} onClick={() => setPwGate({ kind: "delete", notice: n })}>
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="halert-create">
              {!composing ? (
                <button type="button" className="btn line sm" onClick={() => { setComposing(true); setBody(""); setRoomId(""); setErr(null); }}>
                  + 전달사항
                </button>
              ) : (
                <form
                  className="rmemo-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitDelivery();
                  }}
                >
                  <div className="rmemo-row">
                    <input
                      ref={deliveryInputRef}
                      className="inp"
                      value={body}
                      maxLength={ROOM_MEMO_BODY_MAX}
                      placeholder="예: 계란주문 · 청소기 고장 · 보일러 공기빼기"
                      aria-label="전달사항 내용"
                      onChange={(e) => setBody(e.target.value.slice(0, ROOM_MEMO_BODY_MAX))}
                    />
                    <button type="submit" className="btn red sm" disabled={busy}>
                      {busy ? "…" : "남기기"}
                    </button>
                    <button
                      type="button"
                      className="btn line sm"
                      disabled={busy}
                      onClick={() => {
                        setComposing(false);
                        setBody("");
                        setRoomId("");
                        setErr(null);
                      }}
                    >
                      취소
                    </button>
                  </div>
                  <label className="halert-room">
                    <span className="muted">호실(선택)</span>
                    <select className="inp sm" value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="호실 선택">
                      <option value="">호텔 공용</option>
                      {rooms.map((r) => (
                        <option key={r.id} value={r.id}>
                          {L.roomLabel(r.id) ?? r.no}
                        </option>
                      ))}
                    </select>
                  </label>
                  {err ? <div className="ferr">{err}</div> : null}
                </form>
              )}
            </div>
            <div className="rmemo-list">
              {!deliveries.length ? <div className="lempty">미해결 인수인계가 없어요</div> : null}
              {deliveries.map((m) => {
                const label = m.roomId ? L.roomLabel(m.roomId) ?? m.roomId : null;
                return (
                  <div key={m.id} className="rmemo-item">
                    <div className="rmemo-main">
                      {label ? <span className="halert-room-tag">{label}</span> : <span className="halert-room-tag hotel">호텔</span>}
                      <span className={`rmemo-kind k-${m.kind}`}>{ROOM_MEMO_KIND_LABEL[m.kind]}</span>
                      <span className="rmemo-body">{m.body}</span>
                    </div>
                    <div className="rmemo-acts">
                      <button type="button" className="btn sm line" disabled={busy} onClick={() => void resolveDelivery(m)}>
                        해결
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {pwGate ? (
          <div className="dim notices-pw-dim" onMouseDown={(e) => e.target === e.currentTarget && (setPwGate(null), setPw(""), setPwErr(null))}>
            <div className="modal notices-pw-modal" role="dialog" aria-label={pwGate.kind === "delete" ? "삭제 확인" : "수정 확인"}>
              <div className="mh">
                <h2>{pwGate.kind === "delete" ? "공지 삭제" : "공지 수정"}</h2>
                <button type="button" className="x" onClick={() => { setPwGate(null); setPw(""); setPwErr(null); }}>
                  <X size={16} strokeWidth={2.2} aria-hidden />
                </button>
              </div>
              <p className="muted notices-pw-hint">로그인 비밀번호를 입력해 주세요</p>
              <form
                className="rmemo-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void confirmPw();
                }}
              >
                <input
                  ref={pwRef}
                  className="inp"
                  type="password"
                  autoComplete="current-password"
                  value={pw}
                  aria-label="비밀번호"
                  onChange={(e) => setPw(e.target.value)}
                />
                {pwErr ? <div className="ferr">{pwErr}</div> : null}
                <div className="rmemo-row">
                  <button type="submit" className={`btn sm ${pwGate.kind === "delete" ? "red" : ""}`} disabled={busy}>
                    {busy ? "…" : pwGate.kind === "delete" ? "삭제" : "확인"}
                  </button>
                  <button type="button" className="btn line sm" disabled={busy} onClick={() => { setPwGate(null); setPw(""); setPwErr(null); }}>
                    취소
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
