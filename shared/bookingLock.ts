// 예약 저장 충돌 확인 (낙관적 잠금): 내가 예약을 연 뒤 다른 직원이 먼저 저장했으면 덮어쓰지 않아요.
// 세 가지를 견줘요 — 열었을 때(opened) · 내가 고친 것(draft) · 지금 DB(current).
//  - 내가 안 고친 칸은 쓰지 않아요 (다른 직원이 고친 값이 그대로 남아요)
//  - 같은 칸을 둘 다 다르게 고쳤으면 저장을 멈추고 '다시 불러 주세요'라고 알려요

export type BookingRowLike = Record<string, unknown>;

export interface BookingMergePlan {
  /** 둘 다 다르게 고친 칸 (있으면 저장하지 않아요) */
  conflicts: string[];
  /** 지금 DB 위에 쓸 칸 (내가 고친 칸 중 아직 DB와 다른 것만) */
  write: BookingRowLike;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export function planBookingMerge(opened: BookingRowLike, draft: BookingRowLike, current: BookingRowLike): BookingMergePlan {
  const conflicts: string[] = [];
  const write: BookingRowLike = {};
  for (const k of Object.keys(draft)) {
    if (same(draft[k], opened[k])) continue; // 내가 안 고친 칸
    if (same(current[k], draft[k])) continue; // 이미 같은 값
    if (!same(current[k], opened[k])) {
      conflicts.push(k); // 다른 직원도 이 칸을 다르게 고쳤어요
      continue;
    }
    write[k] = draft[k];
  }
  return { conflicts, write };
}

const FIELD_LABEL: Record<string, string> = {
  price: "판매가",
  nights: "박수",
  check_in: "입실일",
  room_id: "객실",
  room_segments: "객실 이동",
  guest_name: "손님 이름",
  guest_phone: "연락처",
  night_rates: "박별 요금",
  memo: "메모",
  status: "예약 상태",
  platform_id: "예약 경로",
  type_id: "객실 타입",
  arrived: "입실 여부",
  checked_out_at: "퇴실 처리",
};

export class BookingConflictError extends Error {
  readonly fields: string[];
  constructor(fields: string[]) {
    super(bookingConflictMessage(fields));
    this.name = "BookingConflictError";
    this.fields = fields;
  }
}

export function bookingConflictMessage(fields: string[]): string {
  const names = [...new Set(fields.map((f) => FIELD_LABEL[f] ?? "예약 내용"))];
  return `다른 직원이 먼저 이 예약을 고쳤어요 (${names.join(", ") || "예약 내용"}). 덮어쓰지 않았어요. 창을 닫고 다시 열어 최신 내용을 확인한 뒤 저장해 주세요.`;
}
