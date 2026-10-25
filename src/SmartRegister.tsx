/**
 * 스마트 등록 — dedicated board tab (full FO).
 * Paste TSV → profile detect → wide preview → askConfirm → saveBooking × N (Path A 미배정).
 */
import { useCallback, useMemo, useState, type ClipboardEvent, type ReactNode } from "react";
import { ClipboardPaste, Link2, LoaderCircle, BookmarkPlus } from "lucide-react";
import {
  type Booking,
  type HotelSettings,
  stockTable,
  typeLabel,
  usableTypes,
  validateBooking,
  won,
  addDays,
} from "../shared/ledger";
import { saveFailMessage } from "../shared/errors";
import { validateGuestPhone } from "../shared/payment";
import {
  PLATFORM_PROFILES,
  type PlatformProfileId,
  type PreviewRow,
  buildPreviewRows,
  cancelDraftFromMatch,
  detectProfile,
  matchPlatformId,
  htmlTableToPlain,
  parsePasteTable,
  pathACancelDraftFromPreview,
  pathADraftFromPreview,
  profileById,
  recomputeRowStatus,
  upsertTypeAlias,
} from "../shared/smartRegister";
import type { HotelData } from "./data";
import { askConfirm } from "./ConfirmDialog";
import { Chip, ChipGroup, Inp } from "./primitives";
import { lookups, uid } from "./ui";

interface Props {
  data: HotelData;
  s: HotelSettings;
  today: string;
  tabs: ReactNode;
  banner: ReactNode;
  readOnly?: boolean;
  notify: (m: string) => void;
}

type MountSummary = {
  ok: number;
  cancelled: number;
  skipped: number;
  failed: { reservationId: string; reason: string }[];
};

function statusLabel(r: PreviewRow): string {
  if (r.rowStatus === "ok") return "신규";
  if (r.rowStatus === "cancel") return "예약취소";
  if (r.rowStatus === "need_fix") return "수정필요";
  if (r.rowStatus === "dup") return "중복스킵";
  if (r.cancelGuard) return "입실·퇴실 — 수동";
  return "건너뜀";
}

export default function SmartRegister({ data, s, today, tabs, banner, readOnly = false, notify }: Props) {
  const L = useMemo(() => lookups(s), [s]);
  const types = usableTypes(s.types).filter((t) => typeLabel(t));

  const [paste, setPaste] = useState("");
  const [profileId, setProfileId] = useState<PlatformProfileId | null>(null);
  const [profileForced, setProfileForced] = useState(false);
  const [detectWeak, setDetectWeak] = useState(false);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [parseErr, setParseErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<MountSummary | null>(null);

  const profile = profileId ? profileById(profileId) : undefined;
  const platformId = profile ? matchPlatformId(profile, s) : null;
  const platformLabel = profile?.label ?? "플랫폼";

  const channelLabels = useMemo(
    () =>
      (s.platforms ?? []).flatMap((p) =>
        [p.name, p.abbr].filter((x): x is string => typeof x === "string" && x.trim().length > 0),
      ),
    [s.platforms],
  );

  const rebuild = useCallback(
    (text: string, forcedId: PlatformProfileId | null, forced: boolean) => {
      setSummary(null);
      const table = parsePasteTable(text, { channelLabels });
      if (!table) {
        setRows([]);
        setParseErr(
          text.trim()
            ? "표(헤더+데이터 행)를 인식하지 못했어요. 목록 표에서 Ctrl+A로 전체 선택 후 복사하거나, 엑셀로보낸 뒤 붙여넣어 보세요."
            : null,
        );
        if (!forced) {
          setProfileId(null);
          setDetectWeak(false);
        }
        return;
      }
      const det = detectProfile(table.headers, text);
      let pid = forced && forcedId ? forcedId : det.confident ? det.profileId : forcedId;
      const weak = !det.confident;
      setDetectWeak(weak);
      if (!forced) setProfileId(pid);
      else setProfileId(forcedId);

      const useId = forced ? forcedId : pid;
      if (!useId) {
        setRows([]);
        setParseErr(weak ? "플랫폼을 골라 주세요. (형식 자동인식 약함)" : "프로필을 골라 주세요.");
        return;
      }
      const p = profileById(useId);
      if (!p) {
        setRows([]);
        setParseErr("알 수 없는 프로필이에요.");
        return;
      }
      const platId = matchPlatformId(p, s);
      const preview = buildPreviewRows(table, p, s, data.bookings, platId);
      setRows(preview);
      setParseErr(null);
    },
    [s, data.bookings, channelLabels],
  );

  const onPasteChange = (v: string) => {
    setPaste(v);
    setProfileForced(false);
    rebuild(v, null, false);
  };

  /** Prefer clipboard HTML table when partner UI copies markup (야놀자 통합내역 등). */
  const onPasteEvent = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const html = e.clipboardData.getData("text/html");
    if (!html || !/<table[\s>]/i.test(html)) return;
    const plain = htmlTableToPlain(html);
    if (!plain) return;
    e.preventDefault();
    onPasteChange(plain);
  };

  const onPickProfile = (id: PlatformProfileId) => {
    setProfileForced(true);
    setProfileId(id);
    rebuild(paste, id, true);
  };

  const patchRow = (key: string, patch: Partial<PreviewRow>) => {
    setRows((list) =>
      list.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        // dup stay non-actionable even if skip toggled
        if (patch.skip === false && next.dup) {
          next.skip = true;
        }
        next.rowStatus = recomputeRowStatus(next);
        return next;
      }),
    );
  };

  /** Preview → persist alias for this platformTypeName (nice-to-have). */
  const saveAliasFromRow = async (r: PreviewRow) => {
    const aliasPlat = r.platformId ?? platformId;
    if (readOnly || busy || !aliasPlat || !r.typeId || !r.typeRaw.trim()) return;
    const name = r.typeRaw.trim();
    const nextAliases = upsertTypeAlias(
      s.typeAliases ?? [],
      { platformId: aliasPlat, platformTypeName: name, typeId: r.typeId },
      () => uid("ta"),
    );
    try {
      await data.saveHotel({ settings: { ...s, typeAliases: nextAliases } });
      notify(`「${name}」 타입 매칭을 저장했어요`);
    } catch (e) {
      notify(e instanceof Error ? `저장 실패: ${e.message}` : "타입 매칭을 저장하지 못했어요");
    }
  };

  const createTargets = rows.filter((r) => !r.skip && r.rowStatus === "ok");
  const cancelTargets = rows.filter((r) => !r.skip && r.rowStatus === "cancel");
  const readyCount = createTargets.length + cancelTargets.length;
  const skipCount = rows.filter(
    (r) => r.skip || r.rowStatus === "skip" || r.rowStatus === "dup",
  ).length;
  const fixCount = rows.filter((r) => !r.skip && r.rowStatus === "need_fix").length;
  const actionableMissingPlatform = [...createTargets, ...cancelTargets].some((r) => !r.platformId);

  const mount = async () => {
    if (readOnly || busy) return;
    if (!profile) {
      notify("설정에 맞는 플랫폼이 없어요. 설정에서 채널을 추가해 주세요.");
      return;
    }
    const actionable = rows.filter((r) => !r.skip && (r.rowStatus === "ok" || r.rowStatus === "cancel"));
    if (actionable.some((r) => !r.platformId)) {
      notify("설정에 맞는 플랫폼이 없어요. 설정에서 채널을 추가해 주세요.");
      return;
    }
    if (fixCount > 0) {
      notify(`수정필요 ${fixCount}건을 고치거나 건너뛴 뒤 올려 주세요.`);
      return;
    }
    const creates = rows.filter((r) => !r.skip && r.rowStatus === "ok");
    const cancels = rows.filter((r) => !r.skip && r.rowStatus === "cancel");
    if (!creates.length && !cancels.length) {
      notify("올릴 행이 없어요.");
      return;
    }

    const guarded = cancels.filter((r) => r.cancelGuard);
    if (guarded.length) {
      const names = guarded
        .map((r) => r.guestName || r.reservationId)
        .slice(0, 8)
        .join(", ");
      const guardOk = await askConfirm({
        title: "입실·퇴실 예약 취소",
        body: `이미 입실했거나 퇴실 완료된 예약 ${guarded.length}건이 포함돼 있어요.\n${names}${guarded.length > 8 ? "…" : ""}\n정말 예약취소할까요? · 재고·보드가 바뀝니다.`,
        confirmLabel: "예약취소",
        danger: true,
      });
      if (!guardOk) return;
    }

    // type-hold overbook warn (aggregate) — create rows only
    if (creates.length) {
      const impact: { typeId: string; after: number }[] = [];
      const byType = new Map<string, { checkIn: string; nights: number; n: number }[]>();
      for (const r of creates) {
        const tid = r.typeId!;
        const list = byType.get(tid) ?? [];
        list.push({ checkIn: r.checkIn!, nights: r.nights!, n: 1 });
        byType.set(tid, list);
      }
      for (const [tid, stays] of byType) {
        let sim = data.bookings.slice();
        for (const st of stays) {
          for (let k = 0; k < st.n; k++) {
            const probe: Booking = {
              id: `__sr_${tid}_${k}`,
              kind: "stay",
              status: "active",
              platformId: creates[0]?.platformId ?? platformId ?? "p",
              price: 0,
              guestName: "_",
              typeId: tid,
              roomId: null,
              checkIn: st.checkIn,
              nights: st.nights,
              startTime: null,
              endTime: null,
              arrived: false,
              memo: null,
              cancelledAt: null,
              createdAt: today,
              updatedAt: today,
            };
            sim = [...sim, probe];
          }
        }
        const dates = new Set<string>();
        for (const st of stays) {
          for (let i = 0; i < st.nights; i++) dates.add(addDays(st.checkIn, i));
        }
        const table = stockTable(s, sim, [...dates]);
        const minAfter = Math.min(...[...dates].map((d) => table.get(tid)?.get(d) ?? 0));
        if (minAfter < 0) impact.push({ typeId: tid, after: minAfter });
      }
      if (impact.length) {
        const overOk = await askConfirm({
          title: "타입 재고 부족",
          body: `${impact.map((x) => typeLabel(L.types.get(x.typeId))).join(", ")} 타입 재고가 모자랍니다(오버부킹). 그래도 올릴까요? · 물리 방 겹침은 미배정이라 해당 없어요.`,
          confirmLabel: "올리기",
        });
        if (!overOk) return;
      }
    }

    const platNames = [
      ...new Set(
        [...creates, ...cancels].map((r) => r.platformLabel).filter((x) => x.trim().length > 0),
      ),
    ];
    const ok = await askConfirm({
      title: "스마트 등록",
      body: [
        creates.length ? `신규 ${creates.length}건` : null,
        cancels.length ? `예약취소 ${cancels.length}건` : null,
        platNames.length ? `플랫폼 ${platNames.join("·")}` : `플랫폼 ${platformLabel}`,
        skipCount ? `건너뜀 ${skipCount}건` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      confirmLabel: "확인 올리기",
      danger: cancels.length > 0 && creates.length === 0,
    });
    if (!ok) return;

    const total = cancels.length + creates.length;
    setBusy(true);
    setProgress(`0 / ${total}`);
    setSummary(null);
    const failed: MountSummary["failed"] = [];
    let saved = 0;
    let cancelled = 0;
    const nowIso = new Date().toISOString();
    let step = 0;

    // Cancels first (free stock / record missing cancels) then Path A creates
    for (const row of cancels) {
      step += 1;
      setProgress(`${step} / ${total}`);
      if (row.matchBookingId) {
        const live = data.bookings.find((b) => b.id === row.matchBookingId);
        if (!live || live.status !== "active") {
          failed.push({ reservationId: row.reservationId || row.guestName, reason: "Hotori에 없거나 이미 취소됨" });
          continue;
        }
        try {
          await data.saveBooking(cancelDraftFromMatch(live, nowIso), false);
          cancelled += 1;
        } catch (e) {
          failed.push({
            reservationId: row.reservationId || row.guestName,
            reason: saveFailMessage(e),
          });
        }
        continue;
      }
      // No match → Path A 미배정 create-as-cancelled (isActive/stock exclude cancelled)
      const rowPlatId = row.platformId!;
      const rowPlatLabel = row.platformLabel || platformLabel;
      const draft = pathACancelDraftFromPreview(row, {
        platformId: rowPlatId,
        platformLabel: rowPlatLabel,
        id: crypto.randomUUID(),
        nowIso,
      });
      const platCancel = s.platforms.find((p) => p.id === rowPlatId);
      const phoneErrCancel = validateGuestPhone(platCancel, draft.guestPhone);
      if (phoneErrCancel) {
        failed.push({ reservationId: row.reservationId || row.guestName, reason: phoneErrCancel });
        continue;
      }
      const vCancel = validateBooking(draft, s);
      if (vCancel) {
        failed.push({ reservationId: row.reservationId || row.guestName, reason: vCancel });
        continue;
      }
      try {
        await data.saveBooking(draft, true);
        cancelled += 1;
      } catch (e) {
        failed.push({
          reservationId: row.reservationId || row.guestName,
          reason: saveFailMessage(e),
        });
      }
    }

    for (const row of creates) {
      step += 1;
      setProgress(`${step} / ${total}`);
      const rowPlatId = row.platformId!;
      const rowPlatLabel = row.platformLabel || platformLabel;
      const draft = pathADraftFromPreview(row, {
        platformId: rowPlatId,
        platformLabel: rowPlatLabel,
        id: crypto.randomUUID(),
        nowIso,
      });
      const plat = s.platforms.find((p) => p.id === rowPlatId);
      const phoneErr = validateGuestPhone(plat, draft.guestPhone);
      if (phoneErr) {
        failed.push({ reservationId: row.reservationId || row.guestName, reason: phoneErr });
        continue;
      }
      const v = validateBooking(draft, s);
      if (v) {
        failed.push({ reservationId: row.reservationId || row.guestName, reason: v });
        continue;
      }
      try {
        await data.saveBooking(draft, true);
        saved += 1;
      } catch (e) {
        failed.push({
          reservationId: row.reservationId || row.guestName,
          reason: saveFailMessage(e),
        });
      }
    }

    const result: MountSummary = {
      ok: saved,
      cancelled,
      skipped: skipCount,
      failed,
    };
    setSummary(result);
    setBusy(false);
    setProgress(null);
    notify(
      `스마트 등록` +
        (saved ? ` 신규 ${saved}` : "") +
        (cancelled ? ` · 예약취소 ${cancelled}` : "") +
        (!saved && !cancelled ? " 0건" : "") +
        (skipCount ? ` · 건너뜀 ${skipCount}` : "") +
        (failed.length ? ` · 실패 ${failed.length}` : ""),
    );
    if (paste) rebuild(paste, profileId, profileForced);
  };

  return (
    <main className="page board-page one">
      <div className="main">
        {tabs}
        {banner}
        <header className="smart-reg-head">
          <h1>스마트 등록</h1>
          <p className="sub">파트너센터 예약목록을 붙여넣으면 미배정으로 올려요. 채널 API 없음.</p>
          <a className="smart-reg-alias-link" href="#/settings/type-aliases">
            <Link2 size={14} strokeWidth={2.2} aria-hidden />
            설정 · 타입 매칭
          </a>
        </header>

        <div className="smart-reg-panes">
          <aside className="smart-reg-paste">
            <label className="smart-reg-paste-label" htmlFor="smart-reg-ta">
              <ClipboardPaste size={16} strokeWidth={2.2} aria-hidden />
              붙여넣기
            </label>
            <textarea
              id="smart-reg-ta"
              className="inp smart-reg-ta"
              value={paste}
              onChange={(e) => onPasteChange(e.target.value)}
              onPaste={onPasteEvent}
              placeholder={"예약번호\t예약자\t연락처\t객실타입\t체크인\t체크아웃\t박수\t판매금액\t상태\n…"}
              spellCheck={false}
              disabled={readOnly || busy}
              rows={12}
            />
            {(detectWeak || !profileId) && paste.trim() ? (
              <div className="smart-reg-chip-block">
                <div className="sub">플랫폼 {detectWeak ? "(자동인식 약함 — 골라 주세요)" : ""}</div>
                <ChipGroup scroll>
                  {PLATFORM_PROFILES.map((p) => (
                    <Chip
                      key={p.id}
                      sm
                      active={profileId === p.id}
                      tone={p.active ? "info" : undefined}
                      onClick={() => onPickProfile(p.id)}
                      disabled={busy}
                    >
                      {p.label}
                      {!p.active ? " · 미검증" : ""}
                    </Chip>
                  ))}
                </ChipGroup>
              </div>
            ) : profile ? (
              <div className="smart-reg-chip-block">
                <ChipGroup>
                  <Chip sm active tone="info" onClick={() => setDetectWeak(true)}>
                    {profile.label}
                    {platformId ? "" : " · 설정 미연결"}
                  </Chip>
                  <Chip sm onClick={() => setDetectWeak(true)} disabled={busy}>
                    변경
                  </Chip>
                </ChipGroup>
              </div>
            ) : null}
            {parseErr ? <div className="err">{parseErr}</div> : null}
            {!platformId && profile && !rows.some((r) => r.platformId) ? (
              <div className="err">설정 → 플랫폼에 「{profile.label}」을 추가해 주세요.</div>
            ) : null}
            {rows.some((r) => r.nestedChannelUnmatched) ? (
              <div className="sub">
                중첩 채널 라벨이 설정 플랫폼과 안 맞아요 → 붙여넣기 프로필({profile?.label})로 올려요.
              </div>
            ) : null}
          </aside>

          <section className="smart-reg-preview" aria-label="미리보기">
            <div className="smart-reg-preview-bar">
              <span>
                {rows.length ? (
                  <>
                    {rows.length}행
                    {createTargets.length ? ` · 신규 ${createTargets.length}` : ""}
                    {cancelTargets.length ? ` · 예약취소 ${cancelTargets.length}` : ""}
                    {!createTargets.length && !cancelTargets.length && readyCount === 0 ? " · 적용 0" : ""}
                    {fixCount ? ` · 수정필요 ${fixCount}` : ""}
                    {skipCount ? ` · 건너뜀 ${skipCount}` : ""}
                  </>
                ) : (
                  "미리보기"
                )}
              </span>
              <button
                type="button"
                className="btn stop"
                disabled={
                  readOnly ||
                  busy ||
                  !readyCount ||
                  !!fixCount ||
                  actionableMissingPlatform
                }
                onClick={() => void mount()}
              >
                {busy ? (
                  <>
                    <LoaderCircle size={16} strokeWidth={2.2} className="spin" aria-hidden />
                    {progress ?? "올리는 중"}
                  </>
                ) : (
                  "확인 올리기"
                )}
              </button>
            </div>

            {summary ? (
              <div className="smart-reg-summary" role="status">
                신규 {summary.ok}
                {summary.cancelled ? ` · 예약취소 ${summary.cancelled}` : ""}
                {` · 건너뜀 ${summary.skipped}`}
                {summary.failed.length
                  ? ` · 실패 ${summary.failed.length} (${summary.failed
                      .slice(0, 5)
                      .map((f) => f.reservationId)
                      .join(", ")}${summary.failed.length > 5 ? "…" : ""})`
                  : ""}
              </div>
            ) : null}

            <div className="smart-reg-table-wrap">
              <table className="smart-reg-table">
                <thead>
                  <tr>
                    <th>상태</th>
                    <th>이름</th>
                    <th>전화</th>
                    <th>타입</th>
                    <th>입실</th>
                    <th>박수</th>
                    <th>판매금</th>
                    <th>예약번호</th>
                    <th>건너뛰기</th>
                  </tr>
                </thead>
                <tbody>
                  {!rows.length ? (
                    <tr>
                      <td colSpan={9} className="smart-reg-empty">
                        왼쪽(또는 위)에 표를 붙여넣으면 여기에 미리보기가 나타나요.
                      </td>
                    </tr>
                  ) : (
                    rows.map((r) => (
                      <tr
                        key={r.key}
                        className={
                          r.skip
                            ? "is-skip"
                            : r.rowStatus === "need_fix"
                              ? "is-fix"
                              : r.rowStatus === "cancel"
                                ? "is-cancel"
                                : ""
                        }
                      >
                        <td>
                          <span
                            className={
                              "smart-reg-st" +
                              (r.rowStatus === "ok"
                                ? " ok"
                                : r.rowStatus === "cancel"
                                  ? " cancel"
                                  : r.rowStatus === "need_fix"
                                    ? " fix"
                                    : r.rowStatus === "dup"
                                      ? " dup"
                                      : " skip")
                            }
                          >
                            {statusLabel(r)}
                            {r.nightsInclusiveSuspect ? " · 일→박" : ""}
                          </span>
                        </td>
                        <td>
                          <Inp
                            value={r.guestName}
                            disabled={busy || r.skip}
                            onChange={(e) => patchRow(r.key, { guestName: e.target.value })}
                            aria-label="이름"
                          />
                          {r.nestedChannelRaw ? (
                            <div
                              className="sub"
                              title={
                                r.nestedChannelUnmatched
                                  ? `설정에 「${r.nestedChannelRaw}」 없음 · ${r.platformLabel}로 유지`
                                  : undefined
                              }
                            >
                              {r.nestedChannelUnmatched
                                ? `${r.nestedChannelRaw} · 미연결`
                                : r.platformLabel}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          <Inp
                            value={r.guestPhone}
                            disabled={busy || r.skip}
                            onChange={(e) => patchRow(r.key, { guestPhone: e.target.value })}
                            aria-label="전화"
                          />
                        </td>
                        <td>
                          <select
                            className="inp"
                            value={r.typeId ?? ""}
                            disabled={busy || r.skip}
                            aria-label="타입"
                            onChange={(e) => patchRow(r.key, { typeId: e.target.value || null })}
                          >
                            <option value="">선택</option>
                            {types.map((t) => (
                              <option key={t.id} value={t.id}>
                                {typeLabel(t)}
                              </option>
                            ))}
                          </select>
                          {r.typeRaw ? <div className="sub">{r.typeRaw}</div> : null}
                          {!readOnly && r.typeRaw.trim() && r.typeId && (r.platformId ?? platformId) && !r.skip ? (
                            <button
                              type="button"
                              className="smart-reg-save-alias"
                              disabled={busy}
                              title="이 OTA 이름을 타입 매칭에 저장"
                              onClick={() => void saveAliasFromRow(r)}
                            >
                              <BookmarkPlus size={12} strokeWidth={2.2} aria-hidden />
                              이 이름으로 저장
                            </button>
                          ) : null}
                        </td>
                        <td>
                          <Inp
                            type="date"
                            value={r.checkIn ?? ""}
                            disabled={busy || r.skip}
                            onChange={(e) => patchRow(r.key, { checkIn: e.target.value || null })}
                            aria-label="입실"
                          />
                        </td>
                        <td>
                          <Inp
                            type="number"
                            min={1}
                            max={90}
                            value={r.nights ?? ""}
                            disabled={busy || r.skip}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              patchRow(r.key, { nights: Number.isFinite(n) && n > 0 ? n : null });
                            }}
                            aria-label="박수"
                          />
                        </td>
                        <td>
                          <Inp
                            className="price"
                            value={r.priceUnset ? "" : r.amount != null ? String(r.amount) : ""}
                            placeholder="미정"
                            disabled={busy || r.skip}
                            onChange={(e) => {
                              const raw = e.target.value.replace(/[^\d]/g, "");
                              if (!raw) patchRow(r.key, { amount: null, priceUnset: true });
                              else patchRow(r.key, { amount: Number(raw), priceUnset: false });
                            }}
                            aria-label="판매금"
                          />
                          {!r.priceUnset && r.amount != null ? (
                            <div className="sub">{won(r.amount)}</div>
                          ) : (
                            <div className="sub">금액미정</div>
                          )}
                        </td>
                        <td>
                          <span className="smart-reg-rid">{r.reservationId || "—"}</span>
                        </td>
                        <td>
                          <input
                            type="checkbox"
                            className="smart-reg-skip"
                            checked={r.skip}
                            disabled={busy || r.dup}
                            aria-label="건너뛰기"
                            onChange={(e) => patchRow(r.key, { skip: e.target.checked })}
                          />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
