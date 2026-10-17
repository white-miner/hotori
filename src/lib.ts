import type {
  AppState,
  CommandType,
  Reservation,
  Room,
  RoomIssue,
} from "../shared/types";

export type CommandFn = (
  type: CommandType,
  data: Record<string, unknown>,
  options?: { close?: boolean; undoLabel?: string },
) => Promise<boolean>;

export const money = (n: number) => new Intl.NumberFormat("ko-KR").format(n);
export const won = (n: number) => `${money(n)}원`;
export const wonSign = (n: number) => `₩${money(n)}`;
export const isISODate = (date: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const value = new Date(`${date}T12:00:00Z`);
  return (
    Number.isFinite(value.getTime()) &&
    value.toISOString().slice(0, 10) === date
  );
};
export const addDays = (date: string, amount: number) => {
  if (!isISODate(date)) return "";
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
};
export const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
export const weekday = (d: string) =>
  WEEK[new Date(`${d}T12:00:00Z`).getUTCDay()];
export const longDate = (d: string) =>
  `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일 ${weekday(d)}요일`;
export const shortDate = (d: string) =>
  `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
export const kstMs = (day: string, hm: string) =>
  Date.parse(`${day}T${hm}:00+09:00`);
const hmFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Seoul",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
/** 한국 시간 HH:MM */
export const hm = (ms: number | string) =>
  hmFmt.format(new Date(typeof ms === "string" ? Date.parse(ms) : ms));
export const kstDate = (ms: number) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
/** 오후 3:20 */
export const ampm = (ms: number) => {
  const [h, m] = hm(ms).split(":").map(Number);
  return `${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${String(m).padStart(2, "0")}`;
};
/** 06시 기준 영업일 위 시각(시간, 6~30) */
export const hourOf = (ms: number, businessDate: string) =>
  (ms - kstMs(businessDate, "00:00")) / 3600000;
export const fmtLeft = (min: number) => {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}`;
};
export const fmtLeftShort = (min: number) => {
  const m = Math.max(0, Math.round(min));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(
      "호텔 서버에 연결할 수 없습니다. 잠시 후 다시 불러와 주세요.",
    );
  }
  let value;
  try {
    value = await res.json();
  } catch {
    throw new Error(
      "호텔 서버를 준비하고 있습니다. 잠시 후 다시 불러와 주세요.",
    );
  }
  if (!res.ok)
    throw new Error(
      value.error || "요청을 처리하지 못했습니다. 다시 시도해 주세요.",
    );
  return value;
}

export const statusLabels: Record<Reservation["status"], string> = {
  confirmed: "예약 확정",
  checked_in: "투숙 중",
  checked_out: "퇴실 완료",
  cancelled: "취소",
};
export const roleLabels = {
  owner: "대표",
  manager: "매니저",
  front: "프런트",
  housekeeping: "객실관리",
};
export const cleaningLabels = {
  clean: "청소 완료",
  dirty: "청소 필요",
  cleaning: "청소 중",
};
export const facilityLabels = {
  normal: "정상",
  inspection: "점검 중",
  blocked: "판매 중지",
};
export const paymentLabels = {
  card: "카드",
  cash: "현금",
  transfer: "계좌이체",
  later: "나중에",
};

export const isHourly = (r: Reservation) => r.stayType === "hourly";
export const stayNights = (r: Reservation) => dayDiff(r.checkIn, r.checkOut);
export const kindOf = (r: Reservation) =>
  isHourly(r) ? "대실" : stayNights(r) >= 2 ? "연박" : "숙박";

export type CellStatus = "use" | "rsv" | "vac" | "cln" | "chk";
export const cellLabels: Record<CellStatus, string> = {
  use: "사용중",
  rsv: "예약",
  vac: "빈방",
  cln: "청소",
  chk: "점검",
};
export interface RoomView {
  room: Room;
  status: CellStatus;
  stay?: Reservation;
  next?: Reservation;
  kind?: "대실" | "숙박" | "연박";
  leftMin?: number;
  totalMin?: number;
  /** 지금 처리할 퇴실 (대실 15분 이하 남음, 숙박 퇴실 시각 지남) */
  alert: boolean;
  /** 오늘 퇴실 처리할 수 있는지 */
  canCheckout: boolean;
  issues: RoomIssue[];
  typeName: string;
}

export interface Ctx {
  s: AppState;
  now: number;
  /** 지금 영업일 */
  bd: string;
}

export function roomView(ctx: Ctx, room: Room): RoomView {
  const { s, now } = ctx;
  const typeName = s.roomTypes.find((t) => t.id === room.typeId)?.name || "";
  const issues = s.issues.filter(
    (i) => i.roomId === room.id && i.status !== "resolved",
  );
  const mine = s.reservations.filter((r) => r.roomIds.includes(room.id));
  const stay = mine.find((r) => r.status === "checked_in");
  const arrivalDays = [s.today, s.lateArrivalDate].filter(Boolean);
  const next = mine
    .filter(
      (r) =>
        r.status === "confirmed" &&
        (isHourly(r)
          ? Date.parse(r.endAt!) > now &&
            Date.parse(r.startAt!) < kstMs(addDays(ctx.bd, 1), "06:00")
          : arrivalDays.includes(r.checkIn)),
    )
    .sort((a, b) => arrivalAt(s, a) - arrivalAt(s, b))[0];
  let status: CellStatus = "vac";
  if (room.facility !== "normal") status = "chk";
  else if (stay) status = "use";
  else if (room.cleaning !== "clean") status = "cln";
  else if (next) status = "rsv";
  const v: RoomView = {
    room,
    status,
    stay,
    next,
    alert: false,
    canCheckout: false,
    issues,
    typeName,
  };
  if (stay) {
    v.kind = kindOf(stay);
    if (isHourly(stay)) {
      v.leftMin = (Date.parse(stay.endAt!) - now) / 60000;
      v.totalMin = (stay.hours || 1) * 60;
      v.alert = v.leftMin <= 15;
      v.canCheckout = true;
    } else {
      v.canCheckout = stay.checkOut <= s.today;
      v.alert =
        stay.checkOut < s.today ||
        (stay.checkOut === s.today &&
          now >= kstMs(stay.checkOut, s.settings.checkOutTime));
    }
  }
  return v;
}

export const arrivalAt = (s: AppState, r: Reservation) =>
  isHourly(r)
    ? Date.parse(r.startAt!)
    : kstMs(r.checkIn, s.settings.checkInTime);
export const departureAt = (s: AppState, r: Reservation) =>
  isHourly(r)
    ? Date.parse(r.endAt!)
    : kstMs(r.checkOut, s.settings.checkOutTime);

export const roomNumbers = (s: AppState, r: Reservation) =>
  r.roomIds
    .map((id) => s.rooms.find((room) => room.id === id)?.number)
    .filter(Boolean)
    .join(", ");
export const channelName = (s: AppState, id: string) =>
  s.channels.find((c) => c.id === id)?.name || id;

/** 오늘 영업일의 들고남·청소 일정 */
export interface DayEvent {
  key: string;
  at: number;
  kind: "arrive" | "leave" | "cleanWait" | "cleanEnd" | "inspect";
  room?: Room;
  reservation?: Reservation;
  done: boolean;
  title: string;
  sub: string;
  hot?: boolean;
  progress?: number;
  /** 방 번호 상자 모양 */
  box: "stay" | "short" | "rsv" | "rsvs" | "cln" | "clnW" | "chk" | "past";
}
export function dayEvents(ctx: Ctx): DayEvent[] {
  const { s, now, bd } = ctx;
  const start = kstMs(bd, "06:00"),
    end = kstMs(addDays(bd, 1), "06:00");
  const inDay = (ms: number) => ms >= start && ms < end;
  const out: DayEvent[] = [];
  const firstRoom = (r: Reservation) =>
    s.rooms.find((room) => room.id === r.roomIds[0]);
  const arrivalDays = [s.today, s.lateArrivalDate, bd].filter(Boolean);
  for (const r of s.reservations) {
    if (r.status === "cancelled") continue;
    const room = firstRoom(r);
    const ch = channelName(s, r.channelId);
    const kind = kindOf(r);
    const what = isHourly(r)
      ? `대실 ${r.hours}시간`
      : `${kind} ${stayNights(r)}박`;
    // 들어와요
    if (r.status === "confirmed") {
      const at = arrivalAt(s, r);
      if (
        isHourly(r)
          ? inDay(at) || (at < start && Date.parse(r.endAt!) > now)
          : arrivalDays.includes(r.checkIn)
      )
        out.push({
          key: r.id + "a",
          at,
          kind: "arrive",
          room,
          reservation: r,
          done: false,
          title: `${r.guestName} 님 도착`,
          sub: `${what} · ${ch}${room ? "" : " · 방 배정 전"}`,
          box: isHourly(r) ? "rsvs" : "rsv",
        });
    } else if (r.checkedInAt && inDay(Date.parse(r.checkedInAt))) {
      out.push({
        key: r.id + "a",
        at: Date.parse(r.checkedInAt),
        kind: "arrive",
        room,
        reservation: r,
        done: true,
        title: `${r.guestName} 님 입실`,
        sub: `${what} · ${ch}`,
        box: "past",
      });
    }
    // 나가요
    if (r.status === "checked_in") {
      const due = departureAt(s, r);
      const today = isHourly(r)
        ? inDay(due) || due < end
        : r.checkOut <= s.today;
      if (today) {
        const left = (due - now) / 60000;
        out.push({
          key: r.id + "l",
          at: due,
          kind: "leave",
          room,
          reservation: r,
          done: false,
          hot: left <= 15,
          title: `${r.guestName} 님 ${isHourly(r) ? "대실 끝" : "퇴실"}`,
          sub: isHourly(r)
            ? `${r.hours}시간 중 ${left > 0 ? fmtLeft(left) + " 남음" : fmtLeft(-left) + " 지남"} · ${ch}`
            : `${what} · ${ch}${left < 0 ? " · 퇴실 시각 지남" : ""}`,
          progress: isHourly(r)
            ? Math.min(1, Math.max(0, 1 - left / ((r.hours || 1) * 60)))
            : undefined,
          box: isHourly(r) ? "short" : "stay",
        });
      }
    } else if (r.checkedOutAt && inDay(Date.parse(r.checkedOutAt))) {
      out.push({
        key: r.id + "l",
        at: Date.parse(r.checkedOutAt),
        kind: "leave",
        room,
        reservation: r,
        done: true,
        title: `${r.guestName} 님 퇴실`,
        sub: `${what} 끝`,
        box: "past",
      });
    }
  }
  const cleanMin = s.settings.cleaningMinutes;
  for (const room of s.rooms) {
    if (room.facility !== "normal") continue;
    const since = room.cleaningSince ? Date.parse(room.cleaningSince) : now;
    if (room.cleaning === "dirty")
      out.push({
        key: room.id + "c",
        at: Math.min(since, now),
        kind: "cleanWait",
        room,
        done: false,
        title: "청소 기다리는 중",
        sub: room.cleaningSince
          ? `${fmtLeft((now - since) / 60000)}째 · 담당 배정 전`
          : "청소 필요 · 담당 배정 전",
        box: "clnW",
      });
    if (room.cleaning === "cleaning")
      out.push({
        key: room.id + "c",
        at: since + cleanMin * 60000,
        kind: "cleanEnd",
        room,
        done: false,
        title: "청소 끝날 예정",
        sub: room.cleaningSince
          ? `시작한 지 ${fmtLeft((now - since) / 60000)}`
          : "청소 중",
        box: "cln",
      });
  }
  return out.sort((a, b) => a.at - b.at);
}

/** 층 묶음: 건물동 → 위층부터 */
export function floorsOf(s: AppState) {
  const buildings = [...new Set(s.rooms.map((r) => r.building))];
  return buildings.map((building) => {
    const rooms = s.rooms.filter((r) => r.building === building);
    const floors = [...new Set(rooms.map((r) => r.floor))].sort(
      (a, b) => b - a,
    );
    return {
      building,
      floors: floors.map((floor) => ({
        floor,
        key: `${building}|${floor}`,
        color: s.floorColors[`${building}|${floor}`],
        rooms: rooms
          .filter((r) => r.floor === floor)
          .sort((a, b) =>
            a.number.localeCompare(b.number, "ko", { numeric: true }),
          ),
      })),
    };
  });
}

export const HOTORI_SWATCHES = [
  { hex: "#1E3F8F", name: "쪽빛" },
  { hex: "#1BA6DE", name: "하늘" },
  { hex: "#D9381E", name: "주홍" },
  { hex: "#8DBB2A", name: "연두" },
  { hex: "#14213D", name: "먹색" },
  { hex: "#5F6676", name: "쥐색" },
];
export const SOFT_SWATCHES = [
  { hex: "#E89AAE", name: "벚꽃" },
  { hex: "#F2B84B", name: "황매" },
  { hex: "#9B8BD1", name: "등꽃" },
  { hex: "#5DBB9A", name: "어린대" },
  { hex: "#E8875B", name: "감빛" },
  { hex: "#7FA7D9", name: "물빛" },
  { hex: "#B9925E", name: "모래" },
  { hex: "#C25B7A", name: "매화" },
];
