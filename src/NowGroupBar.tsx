import { useState } from "react";
import { Crown } from "lucide-react";
import type { Booking } from "../shared/ledger";
import { GROUP_BADGE_COLORS, emptyGroupInfo, type GroupBadgeColor } from "../shared/settle";
import { saveFailMessage } from "../shared/errors";
import type { HotelData } from "./data";
import { askConfirm } from "./ConfirmDialog";

export interface VisibleCardGroup { id: string; label: string; name: string; color: GroupBadgeColor; members: Booking[]; lead: Booking | null }

/** 연결·해제·대표·정산은 기존 데이터 명령을 그대로 쓴다. 예약 요금·결제·입퇴실은 수정하지 않는다. */
export default function NowGroupBar({ data, groups, selected, onlyGroups, showLinks, readOnly, roomLabel, onSelect, onOnlyGroups, onShowLinks, onManage, candidates }: {
  data: HotelData; groups: VisibleCardGroup[]; selected: string | null; onlyGroups: boolean; showLinks: boolean; readOnly?: boolean;
  roomLabel: (b: Booking) => string; onSelect: (id: string | null) => void;
  onOnlyGroups: (v: boolean) => void; onShowLinks: (v: boolean) => void; onManage: (id: string) => void; candidates: Booking[];
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attach, setAttach] = useState("");
  const [createFrom, setCreateFrom] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); }
    catch (e) { setError(saveFailMessage(e, "단체 연결을 변경하지 못했어요")); }
    finally { setBusy(false); }
  };
  const group = groups.find((g) => g.id === selected);
  return <section className="detail-groupbar" aria-label="단체예약 관리">
    <div className="detail-groupbar-top">
      <b>단체예약</b>
      <button type="button" className={`chip ${selected === null ? "on" : ""}`} aria-pressed={selected === null} onClick={() => onSelect(null)}>전체</button>
      {groups.map((g) => <button key={g.id} type="button" title={`단체 ID ${g.id}`} className={`detail-group-chip ${g.color}${g.id === selected ? " selected" : ""}`} aria-pressed={g.id === selected} onClick={() => { onSelect(g.id === selected ? null : g.id); setAttach(""); }}><b>{g.label}</b> {g.name}<span>{g.members.length}실</span></button>)}
      {!groups.length ? <span>이 날짜에 표시할 단체가 없습니다.</span> : null}
      <label><input type="checkbox" checked={onlyGroups} onChange={(e) => onOnlyGroups(e.target.checked)} />단체 객실만</label>
      <label><input type="checkbox" checked={showLinks} onChange={(e) => onShowLinks(e.target.checked)} />연결 정보 표시</label>
    </div>
    {group ? <details key={group.id} className="detail-group-manager" open>
      <summary>{group.label} {group.name} · 연결 객실 및 관리</summary>
      <div className="detail-group-manager-body">
        <div className="detail-group-roomlist" aria-label={`${group.label} 연결 객실`}>
          {group.members.map((b, index) => <div key={b.id}><b>{String(index + 1).padStart(2, "0")}</b><span>{b.id === group.lead?.id ? <Crown size={16} aria-label="대표" /> : null}{roomLabel(b)}</span><span>{b.checkedOutAt ? "퇴실완료" : b.arrived ? "입실" : "입실 전"}</span>{!readOnly ? <button type="button" disabled={busy} aria-label={`${roomLabel(b)} 단체 연결 해제`} onClick={() => void run(() => data.moveBookingGroup(b, null))}>연결 해제</button> : null}</div>)}
        </div>
        {!readOnly ? <div className="detail-group-tools">
          <label>대표객실<select aria-label={`${group.label} 대표객실`} disabled={busy} value={data.groups.get(group.id)?.leadBookingId ?? ""} onChange={(e) => void run(() => data.setGroupLead(group.id, e.target.value || null))}><option value="">자동 · {group.lead ? roomLabel(group.lead) : "미지정"}</option>{group.members.map((b) => <option value={b.id} key={b.id}>{roomLabel(b)}</option>)}</select></label>
          <fieldset disabled={busy}><legend>단체 색상</legend>{GROUP_BADGE_COLORS.map((c, i) => <button key={c} type="button" className={`detail-group-swatch ${c}`} aria-label={`${group.label} 단체 색상 ${i + 1}`} aria-pressed={group.color === c} onClick={() => void run(async () => {
            const { id, payments, ...info } = data.groups.get(group.id) ?? emptyGroupInfo(group.id);
            await data.saveGroupInfo(group.id, { ...info, badgeColor: c });
          })} />)}</fieldset>
          <label>기존 예약 연결<select aria-label={`${group.label} 연결할 기존 예약`} value={attach} disabled={busy} onChange={(e) => setAttach(e.target.value)}><option value="">예약을 선택하세요</option>{candidates.map((b) => <option value={b.id} key={b.id}>{roomLabel(b)} · {b.guestName}</option>)}</select></label>
          <button type="button" className="btn line" disabled={!attach || busy} onClick={() => void run(async () => {
            const b = candidates.find((x) => x.id === attach);
            if (b) await data.moveBookingGroup(b, { groupId: group.id, name: group.name });
            setAttach("");
          })}>단체에 연결</button>
          <button type="button" className="btn line" disabled={busy} onClick={() => onManage(group.id)}>단체 상세·객실 추가·결제</button>
          <button type="button" className="btn line" disabled={busy} onClick={async () => {
            if (!await askConfirm({ title: "단체 연결을 모두 해제할까요?", body: "각 예약의 객실·요금·결제·입퇴실 정보는 유지됩니다. 단체로 받은 결제는 원래 단체 정산 내역에 남습니다.", confirmLabel: "연결 모두 해제" })) return;
            void run(async () => { for (const b of group.members) await data.moveBookingGroup(b, null); onSelect(null); });
          }}>전체 연결 해제</button>
        </div> : null}
        <p>객실별 입퇴실과 요금은 독립적으로 유지됩니다. 연결을 해제해도 기존 단체 결제는 원래 단체에 남습니다.</p>
      </div>
    </details> : null}
    {!readOnly && candidates.length ? <details className="detail-group-create"><summary>기존 예약으로 단체 만들기</summary><div><select aria-label="단체로 전환할 예약" value={createFrom} disabled={busy} onChange={(e) => setCreateFrom(e.target.value)}><option value="">첫 예약을 선택하세요</option>{candidates.map((b) => <option key={b.id} value={b.id}>{roomLabel(b)} · {b.guestName}</option>)}</select><button type="button" className="btn line" disabled={!createFrom || busy} onClick={() => void run(async () => { const b = candidates.find((x) => x.id === createFrom); if (b) onSelect(await data.groupify(b)); setCreateFrom(""); })}>단체 만들기</button><span>선택한 예약자의 이름으로 단체를 만들고 기존 예약을 추가 연결할 수 있습니다.</span></div></details> : null}
    {error ? <p role="alert">{error} 이미 처리된 연결은 유지됩니다. 새로고침 후 남은 객실을 확인해 주세요.</p> : null}
  </section>;
}
