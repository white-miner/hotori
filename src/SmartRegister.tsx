/**
 * 스마트 등록 — dedicated board tab (full FO).
 * Paste TSV → profile detect → wide preview → askConfirm → saveBooking × N (Path A 미배정).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Eraser,
  Link2,
  LoaderCircle,
  BookmarkPlus,
  Settings,
  X,
} from "lucide-react";
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
  isExistingReservationRow,
  isFixBlockingRow,
  isFixLabelRow,
  matchPlatformId,
  htmlTableToPlain,
  parsePasteTable,
  pathACancelDraftFromPreview,
  pathADraftFromPreview,
  previewRowStatusLabel,
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
  /** True 수정필요 / blocked skips — excludes 기존예약 */
  skipped: number;
  /** Unchanged Hotori matches (예약번호) — FO 「기존예약」 */
  existing: number;
  failed: { reservationId: string; reason: string }[];
};

type UploadPhase = "idle" | "uploading" | "done";

const UPLOAD_MIN_MS = 500;
const SUMMARY_AUTO_MS = 1800;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusLabel(r: PreviewRow): string {
  return previewRowStatusLabel(r);
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
  const [uploadPhase, setUploadPhase] = useState<UploadPhase>("idle");
  const [progressStep, setProgressStep] = useState(0);
  const [progressTotal, setProgressTotal] = useState(0);
  const [summary, setSummary] = useState<MountSummary | null>(null);
  /** Paste band open; auto-collapses when preview first gains rows (Option A). */
  const [pasteOpen, setPasteOpen] = useState(true);
  const summaryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const prevRowsLen = useRef(0);

  const dismissSummary = useCallback(() => {
    if (summaryTimer.current) {
      clearTimeout(summaryTimer.current);
      summaryTimer.current = null;
    }
    setUploadPhase("idle");
  }, []);

  useEffect(() => {
    return () => {
      if (summaryTimer.current) clearTimeout(summaryTimer.current);
    };
  }, []);

  // Auto-collapse paste after parse; reopen when workspace cleared.
  useEffect(() => {
    if (rows.length > 0 && prevRowsLen.current === 0) setPasteOpen(false);
    if (rows.length === 0 && prevRowsLen.current > 0) setPasteOpen(true);
    prevRowsLen.current = rows.length;
  }, [rows.length]);

  const focusPaste = () => {
    setPasteOpen(true);
    requestAnimationFrame(() => taRef.current?.focus());
  };

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

  /** Empty paste + preview for next batch (does not upload). */
  const clearWorkspace = useCallback((opts?: { keepSummary?: boolean }) => {
    setPaste("");
    setRows([]);
    setParseErr(null);
    setProfileId(null);
    setProfileForced(false);
    setDetectWeak(false);
    if (!opts?.keepSummary) setSummary(null);
  }, []);

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
  const existingCount = rows.filter((r) => isExistingReservationRow(r)).length;
  const dupCancelCount = rows.filter((r) => r.rowStatus === "dup" && r.pasteCancel).length;
  const fixBlockingCount = rows.filter((r) => isFixBlockingRow(r)).length;
  const fixLabelCount = rows.filter((r) => isFixLabelRow(r)).length;
  const actionableMissingPlatform = [...createTargets, ...cancelTargets].some((r) => !r.platformId);

  /** CTA clickable with rows but nothing to upload / blocked — askConfirm next steps (prefs 신규 0건 안내). */
  const guideEmptyOrBlockedUpload = async (kind: "empty" | "fix"): Promise<void> => {
    const summaryBits = [
      existingCount ? `기존예약 ${existingCount}건` : null,
      dupCancelCount ? `중복스킵 ${dupCancelCount}건` : null,
      fixLabelCount ? `수정필요 ${fixLabelCount}건` : null,
      kind === "fix" && readyCount ? `대기 ${readyCount}건(수정필요 해소 후)` : null,
    ].filter(Boolean);
    const lines =
      kind === "fix"
        ? [
            summaryBits.length ? summaryBits.join(" · ") : null,
            `수정필요 ${fixBlockingCount}건을 수정하거나 「건너뛰기」한 뒤 올려 주세요.`,
            "붙여넣기를 비우려면 「새 작성」을 눌러 주세요.",
          ]
        : [
            summaryBits.length ? summaryBits.join(" · ") : null,
            "올릴 신규·예약취소가 없어요.",
            fixLabelCount
              ? "수정필요 행은 타입·날짜 등을 수정하거나 「건너뛰기」한 뒤 다시 올려 주세요."
              : "이미 Hotori에 있는 예약이거나 중복스킵만 있어요.",
            "붙여넣기를 비우려면 「새 작성」을 눌러 주세요.",
          ];
    const clear = await askConfirm({
      title: kind === "fix" ? "수정필요 행이 있어요" : "올릴 행이 없어요",
      body: lines.filter(Boolean).join("\n"),
      confirmLabel: "새 작성",
      cancelLabel: "닫기",
    });
    if (clear) clearWorkspace();
  };

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
    if (fixBlockingCount > 0) {
      await guideEmptyOrBlockedUpload("fix");
      return;
    }
    const creates = rows.filter((r) => !r.skip && r.rowStatus === "ok");
    const cancels = rows.filter((r) => !r.skip && r.rowStatus === "cancel");
    if (!creates.length && !cancels.length) {
      await guideEmptyOrBlockedUpload("empty");
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
          confirmLabel: "업로드",
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
        existingCount ? `기존예약 ${existingCount}건` : null,
        platNames.length ? `플랫폼 ${platNames.join("·")}` : `플랫폼 ${platformLabel}`,
        fixLabelCount ? `수정필요 ${fixLabelCount}건` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      confirmLabel: "확인 업로드",
      danger: cancels.length > 0 && creates.length === 0,
    });
    if (!ok) return;

    const total = cancels.length + creates.length;
    if (summaryTimer.current) {
      clearTimeout(summaryTimer.current);
      summaryTimer.current = null;
    }
    const startedAt = Date.now();
    setBusy(true);
    setUploadPhase("uploading");
    setProgressStep(0);
    setProgressTotal(total);
    setSummary(null);
    const failed: MountSummary["failed"] = [];
    let saved = 0;
    let cancelled = 0;
    const nowIso = new Date().toISOString();
    let step = 0;

    // Cancels first (free stock / record missing cancels) then Path A creates
    for (const row of cancels) {
      step += 1;
      setProgressStep(step);
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
      setProgressStep(step);
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
      skipped: fixLabelCount,
      existing: existingCount,
      failed,
    };
    const elapsed = Date.now() - startedAt;
    if (elapsed < UPLOAD_MIN_MS) await sleep(UPLOAD_MIN_MS - elapsed);
    setBusy(false);
    setUploadPhase("done");
    notify(
      `스마트 등록` +
        (saved ? ` 신규 ${saved}` : "") +
        (cancelled ? ` · 예약취소 ${cancelled}` : "") +
        (existingCount ? ` · 기존예약 ${existingCount}` : "") +
        (!saved && !cancelled && !existingCount ? " 0건" : "") +
        (fixLabelCount ? ` · 수정필요 ${fixLabelCount}` : "") +
        (failed.length ? ` · 실패 ${failed.length}` : ""),
    );
    // Full success → clear paste/preview for next date batch; keep summary for overlay.
    // Any failure → keep paste so FO can fix (rebuild refreshes dup/status).
    if (failed.length === 0) {
      clearWorkspace({ keepSummary: true });
      setSummary(result);
    } else {
      if (paste) rebuild(paste, profileId, profileForced);
      setSummary(result);
    }
    summaryTimer.current = setTimeout(() => {
      summaryTimer.current = null;
      setUploadPhase("idle");
    }, SUMMARY_AUTO_MS);
  };

  const progressPct =
    progressTotal > 0 ? Math.min(100, Math.round((progressStep / progressTotal) * 100)) : 0;

  return (
    <main className="page board-page one">
      <div className="main">
        {tabs}
        {banner}
        <header className="smart-reg-head">
          <div className="smart-reg-head-row">
            <div className="smart-reg-head-text">
              <h1>스마트 등록</h1>
              <p className="sub">파트너센터 예약목록을 붙여넣으면 미배정으로 올려요. 채널 API 없음.</p>
            </div>
            <div className="smart-reg-head-actions">
              <a className="btn sm line" href="#/settings">
                <Settings size={14} strokeWidth={2.2} aria-hidden />
                설정
              </a>
              <a className="btn sm line" href="#/settings/type-aliases">
                <Link2 size={14} strokeWidth={2.2} aria-hidden />
                타입 매칭
              </a>
            </div>
          </div>
        </header>

        <div className="smart-reg-stack">
          <section
            className={"smart-reg-paste" + (pasteOpen ? "" : " is-collapsed")}
            aria-label="붙여넣기"
          >
            <div className="smart-reg-paste-toolbar">
              <div className="smart-reg-paste-tools">
                <button
                  type="button"
                  className="btn sm line"
                  disabled={readOnly || busy || uploadPhase !== "idle"}
                  onClick={focusPaste}
                  title="붙여넣기 칸으로 이동"
                >
                  <ClipboardPaste size={14} strokeWidth={2.2} aria-hidden />
                  붙여넣기
                </button>
                <button
                  type="button"
                  className="btn sm line"
                  disabled={readOnly || busy || uploadPhase !== "idle" || (!paste.trim() && !rows.length)}
                  onClick={() => clearWorkspace()}
                  title="붙여넣기와 미리보기를 비워요"
                >
                  <Eraser size={14} strokeWidth={2.2} aria-hidden />
                  새 작성
                </button>
              </div>
              {rows.length > 0 ? (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => setPasteOpen((o) => !o)}
                  aria-expanded={pasteOpen}
                >
                  {pasteOpen ? (
                    <>
                      <ChevronUp size={14} strokeWidth={2.2} aria-hidden />
                      접기
                    </>
                  ) : (
                    <>
                      <ChevronDown size={14} strokeWidth={2.2} aria-hidden />
                      펼치기
                    </>
                  )}
                </button>
              ) : null}
            </div>

            {!pasteOpen && rows.length > 0 ? (
              <button
                type="button"
                className="smart-reg-paste-strip"
                onClick={() => setPasteOpen(true)}
              >
                <ClipboardPaste size={14} strokeWidth={2.2} aria-hidden />
                {paste.trim().length.toLocaleString("ko-KR")}자 붙여넣음 · 펼치기
              </button>
            ) : null}

            <div className="smart-reg-paste-body" hidden={!pasteOpen}>
              <textarea
                ref={taRef}
                id="smart-reg-ta"
                className="inp smart-reg-ta"
                value={paste}
                onChange={(e) => onPasteChange(e.target.value)}
                onPaste={onPasteEvent}
                placeholder={"예약번호\t예약자\t연락처\t객실타입\t체크인\t체크아웃\t박수\t판매금액\t상태\n…"}
                spellCheck={false}
                disabled={readOnly || busy}
                rows={8}
                aria-label="붙여넣기"
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
                  중첩 채널 미등록 → 붙여넣기 프로필({profile?.label})로 올려요. 미리보기에 원문 채널이 보여요.{" "}
                  <a className="smart-reg-alias-link" href="#/settings/plats">
                    설정에서 플랫폼 추가
                  </a>
                </div>
              ) : null}
            </div>
          </section>

          <section className="smart-reg-preview" aria-label="미리보기">
            <div className="smart-reg-preview-bar">
              <span>
                {rows.length ? (
                  <>
                    {rows.length}행
                    {createTargets.length ? ` · 신규 ${createTargets.length}` : ""}
                    {existingCount ? ` · 기존예약 ${existingCount}` : ""}
                    {cancelTargets.length ? ` · 예약취소 ${cancelTargets.length}` : ""}
                    {dupCancelCount ? ` · 중복스킵 ${dupCancelCount}` : ""}
                    {!createTargets.length &&
                    !cancelTargets.length &&
                    !existingCount &&
                    readyCount === 0
                      ? " · 적용 0"
                      : ""}
                    {fixLabelCount ? ` · 수정필요 ${fixLabelCount}` : ""}
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
                  uploadPhase !== "idle" ||
                  !rows.length ||
                  actionableMissingPlatform
                }
                onClick={() => void mount()}
                title={
                  !rows.length
                    ? undefined
                    : fixBlockingCount > 0
                      ? `수정필요 ${fixBlockingCount}건 · 안내 보기`
                      : !readyCount
                        ? "올릴 행 없음 · 안내 보기"
                        : undefined
                }
              >
                {busy ? (
                  <>
                    <LoaderCircle size={16} strokeWidth={2.2} className="spin" aria-hidden />
                    {progressTotal
                      ? `${progressStep} / ${progressTotal} 업로드 중…`
                      : "업로드 중…"}
                  </>
                ) : (
                  "확인 업로드"
                )}
              </button>
            </div>

            {summary && uploadPhase === "idle" ? (
              <div className="smart-reg-summary" role="status">
                신규 {summary.ok}
                {summary.cancelled ? ` · 예약취소 ${summary.cancelled}` : ""}
                {summary.existing ? ` · 기존예약 ${summary.existing}` : ""}
                {summary.skipped ? ` · 수정필요 ${summary.skipped}` : ""}
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
                        위에 표를 붙여넣으면 여기에 미리보기가 나타나요.
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
                                  ? `설정에 「${r.nestedChannelRaw}」 없음 · ${r.platformLabel}로 유지 · 메모에 원문 보관`
                                  : undefined
                              }
                            >
                              {r.nestedChannelUnmatched ? (
                                <>
                                  {r.nestedChannelRaw} ·{" "}
                                  <a className="smart-reg-alias-link" href="#/settings/plats">
                                    플랫폼 미등록
                                  </a>
                                </>
                              ) : (
                                r.platformLabel
                              )}
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

      {uploadPhase !== "idle" ? (
        <div
          className="dim assign-type-dim smart-reg-upload-dim"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="smart-reg-upload-title"
          aria-busy={uploadPhase === "uploading"}
        >
          <div className="modal assign-type-modal smart-reg-upload-modal">
            {uploadPhase === "uploading" ? (
              <>
                <div className="mh">
                  <h2 id="smart-reg-upload-title">업로드 중</h2>
                </div>
                <div className="mb">
                  <p className="smart-reg-upload-status">
                    <LoaderCircle size={18} strokeWidth={2.2} className="spin" aria-hidden />
                    {progressTotal
                      ? `${progressStep} / ${progressTotal} 업로드 중…`
                      : "업로드 중…"}
                  </p>
                  <div
                    className="smart-reg-progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={progressTotal || 100}
                    aria-valuenow={progressStep}
                  >
                    <div className="smart-reg-progress-fill" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="mh">
                  <h2 id="smart-reg-upload-title">
                    <Check size={18} strokeWidth={2.6} aria-hidden />
                    업로드 완료
                  </h2>
                  <button type="button" className="x" aria-label="닫기" onClick={dismissSummary}>
                    <X size={16} strokeWidth={2.2} aria-hidden />
                  </button>
                </div>
                <div className="mb">
                  <p className="smart-reg-upload-done">
                    신규 {summary?.ok ?? 0}
                    {summary?.cancelled ? ` · 예약취소 ${summary.cancelled}` : ""}
                    {summary?.existing ? ` · 기존예약 ${summary.existing}` : ""}
                    {summary?.skipped ? ` · 수정필요 ${summary.skipped}` : ""}
                    {summary?.failed.length ? ` · 실패 ${summary.failed.length}` : ""}
                  </p>
                  {summary?.failed.length ? (
                    <p className="sub smart-reg-upload-fail">
                      {summary.failed
                        .slice(0, 5)
                        .map((f) => f.reservationId)
                        .join(", ")}
                      {summary.failed.length > 5 ? "…" : ""}
                    </p>
                  ) : null}
                </div>
                <div className="mf assign-type-acts">
                  <button type="button" className="btn dark" onClick={dismissSummary}>
                    확인
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </main>
  );
}
