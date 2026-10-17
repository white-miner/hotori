export type Plan = "free" | "pro";
export type RoomCleaning = "clean" | "dirty" | "cleaning";
export type RoomFacility = "normal" | "inspection" | "blocked";
export interface RoomType {
  id: string;
  name: string;
  baseRate: number;
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
}
export interface ReportDay {
  date: string;
  revenue: number;
  fee: number;
  netRevenue: number;
  sold: number;
}
export interface Report {
  start: string;
  end: string;
  revenue: number;
  fee: number;
  netRevenue: number;
  sold: number;
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
  | "room.create"
  | "room.update"
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
}
export interface ApiError {
  error: string;
  code: string;
}
