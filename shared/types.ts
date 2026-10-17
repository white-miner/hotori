export type Plan = "free" | "pro";
export type RoomCleaning = "clean" | "dirty" | "cleaning";
export type RoomFacility = "normal" | "inspection" | "blocked";
export interface RoomType {
  id: string;
  name: string;
  baseRate: number;
  /** 대실 기본 요금(기본 시간 묶음 1회). 없으면 설정 기본값을 씁니다. */
  hourlyRate?: number;
}
export type StayType = "nightly" | "hourly";
export type PaymentMethod = "card" | "cash" | "transfer" | "later";
/** 대실·체크인 시간 설정. 예전 데이터에 없으면 기본값을 씁니다. */
export interface OperationSettings {
  /** 대실 기본 묶음 시간(시간). 이 시간까지는 요금이 같습니다. */
  baseHours: number;
  /** 기본 시간을 넘는 1시간마다 붙는 추가 요금 */
  extraHourFee: number;
  /** 대실·숙박 퇴실 뒤 청소에 잡는 시간(분) */
  cleaningMinutes: number;
  /** 숙박 기본 입실·퇴실 시각 (HH:MM, 한국 시간) */
  checkInTime: string;
  checkOutTime: string;
}
export interface Channel {
  id: string;
  name: string;
  feeBps: number;
  color: string;
}
export interface Room {
  id: string;
  number: string;
  building: string;
  floor: number;
  typeId: string;
  cleaning: RoomCleaning;
  facility: RoomFacility;
  version: number;
  /** 특수객실 표시 색 (#RRGGBB). 없으면 표시하지 않습니다. */
  color?: string;
  /** 특수객실 짧은 이름 (예: 스위트, 월풋, 반려동물) */
  label?: string;
  /** 청소 필요·청소 중이 된 시각 */
  cleaningSince?: string;
}
export interface Reservation {
  id: string;
  guestName: string;
  phone: string;
  typeId: string;
  quantity: number;
  checkIn: string;
  checkOut: string;
  channelId: string;
  nightlyRate: number;
  totalAmount: number;
  feeAmount: number;
  feeBps: number;
  netAmount: number;
  status: "confirmed" | "checked_in" | "checked_out" | "cancelled";
  roomIds: string[];
  memo: string;
  version: number;
  createdAt: string;
  createdPlan: Plan;
  protectedFuture?: boolean;
  clipped?: boolean;
  /** 없으면 숙박(nightly)입니다. */
  stayType?: StayType;
  /** 대실 시작·끝 시각 (ISO). 대실만 씁니다. */
  startAt?: string;
  endAt?: string;
  /** 대실 시간(시간) */
  hours?: number;
  payment?: PaymentMethod;
  checkedInAt?: string;
  checkedOutAt?: string;
}
export interface RoomIssue {
  id: string;
  roomId: string;
  title: string;
  detail: string;
  category: "repair" | "condition" | "other";
  priority: "normal" | "urgent";
  status: "open" | "in_progress" | "resolved";
  createdAt: string;
  resolvedAt?: string;
  version: number;
}
export interface Member {
  id: string;
  name: string;
  role: "owner" | "manager" | "front" | "housekeeping";
  active: boolean;
}
export interface Attendance {
  id: string;
  memberId: string;
  clockIn: string;
  clockOut?: string;
}
export interface Audit {
  id: string;
  action: string;
  targetId: string;
  at: string;
  actor: string;
}
export interface Limits {
  months: number;
  historyStart: string;
  futureEnd: string;
  maxRooms: number | null;
  maxOpenIssues: number;
  periodReports: boolean;
  attendance: boolean;
  newSalesBlocked: boolean;
}
export interface TypeInventory {
  typeId: string;
  total: number;
  sold: number;
  blocked: number;
  available: number;
}
export interface Dashboard {
  totalRooms: number;
  soldRooms: number;
  availableRooms: number;
  blockedRooms: number;
  occupancy: number;
  revenue: number;
  fee: number;
  netRevenue: number;
  arrivals: number;
  departures: number;
  unassigned: number;
  openIssues: number;
  inventory: TypeInventory[];
  /** 기준일 영업일의 대실 매출·건수 (숙박 매출은 revenue) */
  hourlyRevenue: number;
  hourlyCount: number;
}
export interface AppState {
  property: {
    id: string;
    name: string;
    tagline: string;
    timezone: string;
    demo: boolean;
  };
  plan: Plan;
  limits: Limits;
  today: string;
  selectedDate: string;
  lateArrivalDate: string | null;
  roomTypes: RoomType[];
  channels: Channel[];
  rooms: Room[];
  reservations: Reservation[];
  issues: RoomIssue[];
  members: Member[];
  attendance: Attendance[];
  audit: Audit[];
  dashboard: Dashboard;
  revision: number;
  settings: OperationSettings;
  /** 층 색. 키는 "건물동|층" (예: "본관|3") */
  floorColors: Record<string, string>;
  /** 서버 시각(ISO)과 지금 영업일(06시 기준) */
  serverNow: string;
  businessDate: string;
  businessDayCutoffHour: number;
}
export interface ReportDay {
  date: string;
  revenue: number;
  fee: number;
  netRevenue: number;
  sold: number;
  /** 숙박·대실 나눈 매출 */
  nightlyRevenue: number;
  hourlyRevenue: number;
  hourlyCount: number;
}
export interface Report {
  start: string;
  end: string;
  revenue: number;
  fee: number;
  netRevenue: number;
  sold: number;
  nightlyRevenue: number;
  hourlyRevenue: number;
  hourlyCount: number;
  days: ReportDay[];
  channels: { channelId: string; revenue: number; sold: number }[];
}
export type CommandType =
  | "reservation.create"
  | "reservation.update"
  | "reservation.cancel"
  | "reservation.assign"
  | "reservation.checkin"
  | "reservation.checkout"
  | "reservation.walkin"
  | "room.create"
  | "room.update"
  | "floor.update"
  | "settings.update"
  | "undo"
  | "issue.create"
  | "issue.update"
  | "property.update"
  | "member.create"
  | "attendance.clockin"
  | "attendance.clockout"
  | "demo.plan";
export interface Command {
  type: CommandType;
  data: Record<string, unknown>;
  requestId: string;
}
export interface CommandResult {
  message: string;
  id?: string;
  revision: number;
  /** 한 번 누르는 작업은 잠깐 되돌릴 수 있습니다. */
  undoToken?: string;
  undoUntil?: string;
}
export interface ApiError {
  error: string;
  code: string;
}
