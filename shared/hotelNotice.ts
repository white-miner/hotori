// 호텔 전체 공지: 탑바 ClipboardList · Threads식 텍스트 피드
// status: open 미해결 · in_progress 진행중 · resolved 해결
// 배지 = open+in_progress (확인/ack와 무관 · 공용 1계정)

export type HotelNoticeStatus = "open" | "in_progress" | "resolved";

export const HOTEL_NOTICE_BODY_MAX = 280;

export const HOTEL_NOTICE_STATUS_LABEL: Record<HotelNoticeStatus, string> = {
  open: "미해결",
  in_progress: "진행중",
  resolved: "해결",
};

export const isHotelNoticeStatus = (v: unknown): v is HotelNoticeStatus =>
  v === "open" || v === "in_progress" || v === "resolved";

export interface HotelNotice {
  id: string;
  body: string;
  status: HotelNoticeStatus;
  resolvedAt: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** 현재 스태프 확인 시각 (receipts · 배지와 무관) */
  ackedAt?: string | null;
  /** 확인 건수 (호텔 전체 · MVP-lite) */
  ackCount?: number;
}

export type HotelNoticeDraft = {
  body: string;
  status?: HotelNoticeStatus;
};

/** 본문 검사. 통과하면 null, 아니면 한글 안내 */
export function validateHotelNoticeDraft(d: HotelNoticeDraft): string | null {
  const body = d.body?.trim() ?? "";
  if (!body) return "공지를 적어 주세요";
  if (body.length > HOTEL_NOTICE_BODY_MAX) return `공지는 ${HOTEL_NOTICE_BODY_MAX}자까지예요`;
  if (d.status != null && !isHotelNoticeStatus(d.status)) return "상태를 확인해 주세요";
  return null;
}

/** 배지용: open + in_progress 건수 (해결·확인과 무관) */
export function unresolvedNoticeCount(list: HotelNotice[]): number {
  let n = 0;
  for (const x of list) {
    if (x.status === "open" || x.status === "in_progress") n += 1;
  }
  return n;
}

/** 피드 정렬: 미해결·진행중 위 · 그 안 최신순 · 해결은 아래 */
export function sortNoticeFeed(list: HotelNotice[], includeResolved: boolean): HotelNotice[] {
  const rows = includeResolved ? list.slice() : list.filter((x) => x.status !== "resolved");
  rows.sort((a, b) => {
    const ar = a.status === "resolved" ? 1 : 0;
    const br = b.status === "resolved" ? 1 : 0;
    if (ar !== br) return ar - br;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return rows;
}

/** 상대 시각 (피드용 · 짧고 조용) */
export function noticeRelativeTime(iso: string, nowMs = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const sec = Math.max(0, Math.floor((nowMs - t) / 1000));
  if (sec < 60) return "방금";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** 수정됨 표시: updated_at이 created_at보다 충분히 뒤 */
export function noticeWasEdited(n: Pick<HotelNotice, "createdAt" | "updatedAt">): boolean {
  const c = Date.parse(n.createdAt);
  const u = Date.parse(n.updatedAt);
  if (!Number.isFinite(c) || !Number.isFinite(u)) return false;
  return u - c > 2000;
}
