import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  addMonths,
  dateValue,
  DomainError,
  lateArrivalDate,
  mutate,
  report,
  seed,
  snapshot,
} from "./domain.js";
import { openStore } from "./store.js";
import {
  acquireLock,
  allowedHostsFrom,
  createApp,
  passwordMatches,
} from "./app.js";
import type { Command, CommandType } from "../shared/types.js";
const today = "2026-10-17";
const clock = () => new Date("2026-10-17T03:00:00Z");
const command = (
  type: CommandType,
  data: Record<string, unknown>,
  requestId = randomUUID(),
): Command => ({ type, data, requestId });
const booking = (extra: Record<string, unknown> = {}) => ({
  guestName: "테스트 손님",
  typeId: "suite",
  quantity: 1,
  checkIn: "2026-10-20",
  checkOut: "2026-10-21",
  channelId: "direct",
  nightlyRate: 100000,
  ...extra,
});
function errorCode(code: string) {
  return (err: unknown) => err instanceof DomainError && err.code === code;
}
describe("HOTORI 업무 규칙", () => {
  it("월말 보정·윤년·형식 검증", () => {
    assert.equal(addMonths("2027-01-31", 1), "2027-02-28");
    assert.equal(addMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addMonths("2026-03-31", -1), "2026-02-28");
    assert.throws(() => dateValue("2026-02-30"), errorCode("INVALID_DATE"));
  });
  it("체크아웃 상한 허용, 상한 숙박 거절", () => {
    const s = seed(today);
    mutate(
      s,
      command(
        "reservation.create",
        booking({ checkIn: "2026-11-16", checkOut: "2026-11-17" }),
      ),
      today,
    );
    assert.throws(
      () =>
        mutate(
          s,
          command(
            "reservation.create",
            booking({ checkIn: "2026-11-17", checkOut: "2026-11-18" }),
          ),
          today,
        ),
      errorCode("PLAN_DATE_LIMIT"),
    );
  });
  it("채널 수수료 누적반올림으로 날짜별 합계 = 예약 금액", () => {
    const s = seed(today);
    s.plan = "pro";
    const result = mutate(
      s,
      command(
        "reservation.create",
        booking({
          nightlyRate: 1,
          channelId: "booking",
          checkIn: "2026-10-20",
          checkOut: "2026-10-24",
        }),
      ),
      today,
    );
    const r = s.reservations.find((r) => r.id === result.id)!;
    assert.equal(r.feeAmount, 1);
    const period = report(s, "2026-10-20", "2026-10-23", today);
    assert.equal(period.fee, 1);
    assert.equal(period.revenue, 4);
    assert.equal(period.netRevenue, 3);
  });
  it("무료 기간리포트 차단, 프로 허용", () => {
    const s = seed(today);
    assert.throws(
      () => report(s, "2026-10-17", "2026-10-18", today),
      errorCode("PRO_REQUIRED"),
    );
    s.plan = "pro";
    assert.equal(report(s, "2026-10-17", "2026-10-18", today).days.length, 2);
  });
  it("과거 기간 밖 예약·감사·요금은 응답 제외, 원본 보존", () => {
    const s = seed(today);
    s.plan = "pro";
    const result = mutate(
      s,
      command(
        "reservation.create",
        booking({ checkIn: "2026-07-20", checkOut: "2026-07-21" }),
      ),
      today,
    );
    s.plan = "free";
    const view = snapshot(s, today, today);
    assert.ok(!view.reservations.some((r) => r.id === result.id));
    assert.ok(!view.audit.some((a) => a.targetId === result.id));
    assert.ok(s.reservations.some((r) => r.id === result.id));
  });
  it("경계 연박 조회는 허용 날짜 금액만 노출", () => {
    const s = seed(today);
    s.plan = "pro";
    const result = mutate(
      s,
      command(
        "reservation.create",
        booking({
          checkIn: "2026-09-15",
          checkOut: "2026-09-19",
          nightlyRate: 100,
        }),
      ),
      today,
    );
    s.plan = "free";
    const r = snapshot(s, today, today).reservations.find(
      (r) => r.id === result.id,
    )!;
    assert.equal(r.checkIn, "2026-09-17");
    assert.equal(r.totalAmount, 200);
    assert.equal(r.clipped, true);
  });
  it("프로에서 연장한 무료 예약도 무료 전환 후 미래 기존업무 보호", () => {
    const s = seed(today);
    const r = mutate(s, command("reservation.create", booking()), today);
    const original = s.reservations.find((x) => x.id === r.id)!;
    s.plan = "pro";
    mutate(
      s,
      command("reservation.update", {
        ...original,
        checkIn: "2027-02-01",
        checkOut: "2027-02-03",
      }),
      today,
    );
    s.plan = "free";
    assert.ok(
      snapshot(s, today, today).reservations.some((x) => x.id === r.id),
    );
    mutate(s, command("reservation.cancel", { id: r.id, version: 2 }), today);
    assert.equal(
      s.reservations.find((x) => x.id === r.id)!.status,
      "cancelled",
    );
  });
  it("기간 밖 오래된 미퇴실 업무는 금액 없이 유지하고 종료 가능", () => {
    const s = seed(today);
    const r = s.reservations.find((x) => x.id === "demo-1")!;
    r.checkIn = "2026-03-01";
    r.checkOut = "2026-03-02";
    const visible = snapshot(s, today, today).reservations.find(
      (x) => x.id === r.id,
    )!;
    assert.equal(visible.totalAmount, 0);
    assert.equal(visible.nightlyRate, 0);
    assert.equal(visible.clipped, true);
    assert.throws(
      () =>
        mutate(
          s,
          command("room.update", {
            id: r.roomIds[0],
            version: 1,
            facility: "blocked",
          }),
          today,
        ),
      errorCode("ASSIGNED_BOOKING_CONFLICT"),
    );
    mutate(s, command("reservation.checkout", { id: r.id, version: 1 }), today);
    assert.ok(
      !snapshot(s, today, today).reservations.some((x) => x.id === r.id),
    );
  });
  it("미해결 한도, 해결 이력 유지·재열기 재검사", () => {
    const s = seed(today);
    const roomId = s.rooms[0].id;
    const a = mutate(
      s,
      command("issue.create", {
        roomId,
        title: "1",
        category: "repair",
        priority: "urgent",
      }),
      today,
    );
    assert.throws(
      () =>
        mutate(
          s,
          command("issue.create", {
            roomId,
            title: "2",
            category: "repair",
            priority: "urgent",
          }),
          today,
        ),
      errorCode("ISSUE_LIMIT"),
    );
    mutate(
      s,
      command("issue.update", { id: a.id, version: 1, status: "resolved" }),
      today,
    );
    mutate(
      s,
      command("issue.create", {
        roomId,
        title: "2",
        category: "repair",
        priority: "urgent",
      }),
      today,
    );
    assert.equal(s.issues.filter((i) => i.roomId === roomId).length, 2);
    assert.throws(
      () =>
        mutate(
          s,
          command("issue.update", { id: a.id, version: 2, status: "open" }),
          today,
        ),
      errorCode("ISSUE_LIMIT"),
    );
  });
  it("객실 20개 한도, 프로 증설 후 무료 기존 데이터 유지", () => {
    const s = seed(today);
    for (let i = 0; i < 4; i++)
      mutate(
        s,
        command("room.create", {
          number: "T" + i,
          floor: 6,
          typeId: "standard",
        }),
        today,
      );
    assert.throws(
      () =>
        mutate(
          s,
          command("room.create", {
            number: "T5",
            floor: 6,
            typeId: "standard",
          }),
          today,
        ),
      errorCode("ROOM_LIMIT"),
    );
    mutate(s, command("demo.plan", { plan: "pro" }), today);
    mutate(
      s,
      command("room.create", { number: "T5", floor: 6, typeId: "standard" }),
      today,
    );
    mutate(s, command("demo.plan", { plan: "free" }), today);
    assert.equal(s.rooms.length, 21);
    assert.equal(snapshot(s, today, today).limits.newSalesBlocked, true);
    assert.throws(
      () => mutate(s, command("reservation.create", booking()), today),
      errorCode("ROOM_LICENSE_REQUIRED"),
    );
  });
  it("무료 전환 후 미래 기존 예약 취소와 근무 퇴근 허용", () => {
    const s = seed(today);
    mutate(s, command("demo.plan", { plan: "pro" }), today);
    const a = mutate(
      s,
      command("attendance.clockin", { memberId: "member-front" }),
      today,
    );
    const r = mutate(
      s,
      command(
        "reservation.create",
        booking({ checkIn: "2027-02-01", checkOut: "2027-02-02" }),
      ),
      today,
    );
    mutate(s, command("demo.plan", { plan: "free" }), today);
    assert.ok(
      snapshot(s, today, today).reservations.some((x) => x.id === r.id),
    );
    mutate(s, command("reservation.cancel", { id: r.id, version: 1 }), today);
    mutate(s, command("attendance.clockout", { id: a.id }), today);
    assert.throws(
      () =>
        mutate(
          s,
          command("attendance.clockin", { memberId: "member-front" }),
          today,
        ),
      errorCode("PRO_REQUIRED"),
    );
  });
  it("배정 충돌·청소 미완료 입실 차단, 퇴실 시 청소 필요", () => {
    const s = seed(today);
    const reservation = s.reservations.find((r) => r.id === "demo-3")!;
    s.rooms.find((r) => r.id === reservation.roomIds[0])!.cleaning = "dirty";
    assert.throws(
      () =>
        mutate(
          s,
          command("reservation.checkin", { id: reservation.id, version: 1 }),
          today,
        ),
      errorCode("ROOM_NOT_READY"),
    );
    const depart = s.reservations.find((r) => r.id === "demo-2")!;
    mutate(
      s,
      command("reservation.checkout", { id: depart.id, version: 1 }),
      today,
    );
    assert.equal(
      s.rooms.find((r) => r.id === depart.roomIds[0])!.cleaning,
      "dirty",
    );
    assert.throws(
      () =>
        mutate(
          s,
          command("room.update", {
            id: "room-201",
            version: 1,
            facility: "blocked",
          }),
          today,
        ),
      errorCode("ASSIGNED_BOOKING_CONFLICT"),
    );
  });
  it("연박 전체 같은 객실 배정 불가 시 보수적으로 저장 거절", () => {
    const s = seed(today);
    s.reservations = [];
    s.rooms = s.rooms
      .filter((r) => r.typeId === "suite")
      .map((r) => ({ ...r, facility: "normal" }));
    mutate(
      s,
      command(
        "reservation.create",
        booking({ checkIn: "2026-10-20", checkOut: "2026-10-21" }),
      ),
      today,
    );
    mutate(
      s,
      command("reservation.assign", {
        id: s.reservations[0].id,
        version: 1,
        roomIds: [s.rooms[0].id],
      }),
      today,
    );
    mutate(
      s,
      command(
        "reservation.create",
        booking({ checkIn: "2026-10-21", checkOut: "2026-10-22" }),
      ),
      today,
    );
    mutate(
      s,
      command("reservation.assign", {
        id: s.reservations[1].id,
        version: 1,
        roomIds: [s.rooms[1].id],
      }),
      today,
    );
    assert.throws(
      () =>
        mutate(
          s,
          command(
            "reservation.create",
            booking({ checkIn: "2026-10-20", checkOut: "2026-10-22" }),
          ),
          today,
        ),
      errorCode("CONTINUOUS_ROOM_REQUIRED"),
    );
  });
  // 현장 수정 1: 자정 이후 늦은 입실(영업일 06:00 기준)
  it("자정~06시에는 전날 1박 예약 입실 허용, 06시 이후와 미래 예약은 거절", () => {
    assert.equal(
      lateArrivalDate("2026-10-17", "2026-10-16T17:00:00Z"),
      "2026-10-16",
    );
    assert.equal(
      lateArrivalDate("2026-10-17", "2026-10-16T20:59:59Z"),
      "2026-10-16",
    );
    assert.equal(lateArrivalDate("2026-10-17", "2026-10-16T21:00:00Z"), null);
    assert.equal(lateArrivalDate("2026-10-17", "2026-10-17T03:00:00Z"), null);
    assert.equal(
      snapshot(seed(today), today, today, "2026-10-16T17:00:00Z")
        .lateArrivalDate,
      "2026-10-16",
    );
    const s = seed(today);
    const late = mutate(
      s,
      command(
        "reservation.create",
        booking({
          typeId: "standard",
          checkIn: "2026-10-16",
          checkOut: "2026-10-17",
        }),
      ),
      "2026-10-16",
    );
    mutate(
      s,
      command("reservation.assign", {
        id: late.id,
        version: 1,
        roomIds: ["room-301"],
      }),
      "2026-10-16",
    );
    mutate(
      s,
      command("reservation.checkin", { id: late.id, version: 2 }),
      today,
      "2026-10-16T17:00:00Z",
    );
    assert.equal(
      s.reservations.find((r) => r.id === late.id)!.status,
      "checked_in",
    );
    const after = mutate(
      s,
      command(
        "reservation.create",
        booking({
          typeId: "standard",
          checkIn: "2026-10-16",
          checkOut: "2026-10-17",
        }),
      ),
      "2026-10-16",
    );
    mutate(
      s,
      command("reservation.assign", {
        id: after.id,
        version: 1,
        roomIds: ["room-302"],
      }),
      "2026-10-16",
    );
    assert.throws(
      () =>
        mutate(
          s,
          command("reservation.checkin", { id: after.id, version: 2 }),
          today,
          "2026-10-16T21:30:00Z",
        ),
      errorCode("INVALID_STATUS"),
    );
    const future = mutate(
      s,
      command(
        "reservation.create",
        booking({
          typeId: "standard",
          checkIn: "2026-10-18",
          checkOut: "2026-10-19",
        }),
      ),
      today,
    );
    mutate(
      s,
      command("reservation.assign", {
        id: future.id,
        version: 1,
        roomIds: ["room-304"],
      }),
      today,
    );
    assert.throws(
      () =>
        mutate(
          s,
          command("reservation.checkin", { id: future.id, version: 2 }),
          today,
          "2026-10-16T17:00:00Z",
        ),
      errorCode("INVALID_STATUS"),
    );
    const tonight = mutate(
      s,
      command(
        "reservation.create",
        booking({ typeId: "standard", checkIn: today, checkOut: "2026-10-18" }),
      ),
      today,
      "2026-10-16T17:00:00Z",
    );
    mutate(
      s,
      command("reservation.assign", {
        id: tonight.id,
        version: 1,
        roomIds: ["room-301"],
      }),
      today,
      "2026-10-16T17:00:00Z",
    );
  });
  // 현장 수정 2: 예정 퇴실일이 지난 미퇴실 투숙
  it("예정 퇴실일 지난 미퇴실 객실은 오늘 재고·현황에서 점유, 다른 예약 배정 차단", () => {
    const s = seed(today);
    const stay = s.reservations.find((r) => r.id === "demo-2")!;
    stay.checkIn = "2026-10-14";
    stay.checkOut = "2026-10-16";
    const view = snapshot(s, today, today);
    const standard = view.dashboard.inventory.find(
      (t) => t.typeId === "standard",
    )!;
    assert.equal(standard.sold, 5);
    assert.equal(standard.available, 3);
    assert.equal(view.dashboard.departures, 1);
    assert.equal(
      snapshot(s, "2026-10-18", today).dashboard.inventory.find(
        (t) => t.typeId === "standard",
      )!.sold,
      2,
    );
    const created = mutate(
      s,
      command(
        "reservation.create",
        booking({ typeId: "standard", checkIn: today, checkOut: "2026-10-18" }),
      ),
      today,
    );
    assert.throws(
      () =>
        mutate(
          s,
          command("reservation.assign", {
            id: created.id,
            version: 1,
            roomIds: ["room-202"],
          }),
          today,
        ),
      errorCode("ROOM_OCCUPIED"),
    );
    mutate(
      s,
      command("reservation.assign", {
        id: created.id,
        version: 1,
        roomIds: ["room-301"],
      }),
      today,
    );
    assert.throws(
      () =>
        mutate(
          s,
          command(
            "reservation.create",
            booking({
              typeId: "standard",
              quantity: 3,
              checkIn: today,
              checkOut: "2026-10-18",
            }),
          ),
          today,
        ),
      errorCode("SOLD_OUT"),
    );
    mutate(
      s,
      command(
        "reservation.create",
        booking({
          typeId: "standard",
          quantity: 2,
          checkIn: today,
          checkOut: "2026-10-18",
        }),
      ),
      today,
    );
    s.rooms.find((r) => r.id === "room-304")!.facility = "blocked";
    const walkin = s.reservations.find((r) => r.id === "demo-4")!;
    mutate(
      s,
      command("reservation.update", { ...walkin, memo: "도착 시간 변경" }),
      today,
    );
    assert.throws(
      () =>
        mutate(
          s,
          command("reservation.update", {
            ...walkin,
            version: 2,
            checkOut: "2026-10-19",
          }),
          today,
        ),
      errorCode("SOLD_OUT"),
    );
    mutate(
      s,
      command("reservation.checkout", { id: stay.id, version: 1 }),
      today,
    );
    assert.equal(snapshot(s, today, today).dashboard.departures, 0);
  });
  it("퇴실 예정일 당일 아침 투숙객은 오늘 밤 재고를 막지 않음(기존 동작 유지)", () => {
    const s = seed(today);
    const view = snapshot(s, today, today);
    assert.equal(
      view.dashboard.inventory.find((t) => t.typeId === "standard")!.sold,
      4,
    );
    const created = mutate(
      s,
      command(
        "reservation.create",
        booking({ typeId: "standard", checkIn: today, checkOut: "2026-10-18" }),
      ),
      today,
    );
    mutate(
      s,
      command("reservation.assign", {
        id: created.id,
        version: 1,
        roomIds: ["room-202"],
      }),
      today,
    );
  });
  // 현장 수정 4: 무료 플랜 빈 호텔 첫 객실
  it("무료 플랜 객실 0개 호텔은 첫 동·첫 객실 등록 가능, 두 번째 동은 계속 제한", () => {
    const s = seed(today);
    s.rooms = [];
    s.reservations = [];
    s.issues = [];
    mutate(
      s,
      command("room.create", {
        number: "101",
        building: "신관",
        floor: 1,
        typeId: "standard",
      }),
      today,
    );
    mutate(
      s,
      command("room.create", {
        number: "102",
        building: "신관",
        floor: 1,
        typeId: "standard",
      }),
      today,
    );
    assert.equal(s.rooms.length, 2);
    assert.throws(
      () =>
        mutate(
          s,
          command("room.create", {
            number: "201",
            building: "별관",
            floor: 2,
            typeId: "standard",
          }),
          today,
        ),
      errorCode("BUILDING_LIMIT"),
    );
    const empty = seed(today);
    empty.rooms = [];
    empty.reservations = [];
    empty.issues = [];
    mutate(
      empty,
      command("room.create", { number: "101", floor: 1, typeId: "standard" }),
      today,
    );
    assert.equal(empty.rooms[0].building, "본관");
  });
});
describe("배포 접근 제어(비밀번호·호스트 허용 목록)", () => {
  type Reply = {
    status: number;
    headers: Record<string, unknown>;
    body: string;
  };
  const call = (
    port: number,
    {
      method = "GET",
      path: target = "/api/state",
      headers = {},
    }: { method?: string; path?: string; headers?: Record<string, string> },
    body?: string,
  ) =>
    new Promise<Reply>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path: target,
          headers,
          agent: false,
        },
        (res) => {
          let data = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: data,
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  const basic = (password: string, user = "hotori") =>
    "Basic " + Buffer.from(`${user}:${password}`, "utf8").toString("base64");
  const serve = async (options: Parameters<typeof createApp>[1]) => {
    const dir = await mkdtemp(path.join(tmpdir(), "hotori-http-"));
    const store = await openStore(dir, clock);
    const server = createApp(store, options).listen(0, "127.0.0.1");
    await once(server, "listening");
    return {
      port: (server.address() as AddressInfo).port,
      close: async () => {
        server.closeAllConnections();
        server.close();
        await store.close();
        await rm(dir, { recursive: true, force: true });
      },
    };
  };
  it("허용 호스트: HOTORI_ALLOWED_HOSTS와 RENDER_EXTERNAL_HOSTNAME을 정리해 합친다", () => {
    assert.deepEqual(
      allowedHostsFrom({
        HOTORI_ALLOWED_HOSTS: " A.example , b.example:8080,,a.example",
        RENDER_EXTERNAL_HOSTNAME: "hotori.onrender.com",
      }),
      ["a.example", "b.example:8080", "hotori.onrender.com"],
    );
    assert.deepEqual(allowedHostsFrom({}), []);
  });
  it("비밀번호 비교: 형식 오류·틀린 값은 거절, 아이디는 무관, 콜론 포함 비밀번호 허용", () => {
    assert.equal(passwordMatches(undefined, "pw"), false);
    assert.equal(passwordMatches("Bearer abc", "pw"), false);
    assert.equal(passwordMatches("Basic !!!", "pw"), false);
    assert.equal(
      passwordMatches(
        "Basic " + Buffer.from("nocolon").toString("base64"),
        "pw",
      ),
      false,
    );
    assert.equal(passwordMatches(basic("pw2"), "pw"), false);
    assert.equal(passwordMatches(basic("pw", "아무나"), "pw"), true);
    assert.equal(passwordMatches(basic("p:w:x"), "p:w:x"), true);
    assert.equal(passwordMatches(basic("호토리-비번"), "호토리-비번"), true);
  });
  it("서버 잠금: 자기 PID·깨진 잠금은 정리하고, 살아 있는 다른 PID는 거절", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "hotori-lock-"));
    const lock = path.join(dir, "server.lock");
    try {
      acquireLock(lock);
      assert.equal(await readFile(lock, "utf8"), String(process.pid));
      acquireLock(lock);
      await writeFile(lock, "garbage");
      acquireLock(lock);
      assert.equal(await readFile(lock, "utf8"), String(process.pid));
      await writeFile(lock, String(process.ppid));
      assert.throws(() => acquireLock(lock), /이미 실행 중/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("HTTP: 비밀번호를 설정하면 화면·API를 막고 health만 열며, 호스트·출처 검사는 유지", async () => {
    const app = await serve({
      port: 10000,
      extraHosts: ["hotori.onrender.com"],
      accessPassword: "s3cret-pw",
    });
    try {
      const render = { host: "hotori.onrender.com" };
      const ok = { ...render, authorization: basic("s3cret-pw") };
      let r = await call(app.port, { headers: render });
      assert.equal(r.status, 401);
      assert.match(
        String(r.headers["www-authenticate"]),
        /^Basic realm="HOTORI"/,
      );
      assert.equal(JSON.parse(r.body).code, "AUTH_REQUIRED");
      r = await call(app.port, { path: "/", headers: render });
      assert.equal(r.status, 401);
      r = await call(app.port, {
        path: "/api/reports?start=2026-10-01&end=2026-10-31",
        headers: render,
      });
      assert.equal(r.status, 401);
      r = await call(app.port, {
        headers: { ...render, authorization: basic("wrong") },
      });
      assert.equal(r.status, 401);
      r = await call(app.port, { headers: ok });
      assert.equal(r.status, 200);
      assert.equal(JSON.parse(r.body).today, today);
      r = await call(app.port, { path: "/api/health", headers: render });
      assert.equal(r.status, 200);
      assert.equal(
        JSON.parse(r.body).authentication,
        "shared-password-basic-auth",
      );
      r = await call(app.port, { headers: { ...ok, host: "evil.example" } });
      assert.equal(r.status, 403);
      assert.equal(JSON.parse(r.body).code, "INVALID_HOST");
      r = await call(app.port, { headers: { ...ok, host: "127.0.0.1:10000" } });
      assert.equal(r.status, 200);
      const post = (origin: string, headers: Record<string, string> = ok) =>
        call(
          app.port,
          {
            method: "POST",
            path: "/api/commands",
            headers: { ...headers, origin, "content-type": "application/json" },
          },
          JSON.stringify(
            command("property.update", { name: "배포 확인 호텔" }),
          ),
        );
      assert.equal(
        (await post("https://hotori.onrender.com", render)).status,
        401,
      );
      assert.equal((await post("https://evil.example")).status, 403);
      r = await post("https://hotori.onrender.com");
      assert.equal(r.status, 200);
      r = await call(app.port, { headers: ok });
      assert.equal(JSON.parse(r.body).property.name, "배포 확인 호텔");
    } finally {
      await app.close();
    }
  });
  it("HTTP: 옵션이 없으면 기존 로컬 동작 그대로(비밀번호 없음, 외부 호스트 거절)", async () => {
    const app = await serve(undefined);
    try {
      let r = await call(app.port, { headers: { host: "127.0.0.1:3100" } });
      assert.equal(r.status, 200);
      r = await call(app.port, {
        path: "/api/health",
        headers: { host: "127.0.0.1:3100" },
      });
      assert.equal(
        JSON.parse(r.body).authentication,
        "trusted-local-demo-only",
      );
      for (const host of [
        "hotori.onrender.com",
        "localhost:3100",
        "127.0.0.1:10000",
      ]) {
        r = await call(app.port, { headers: { host } });
        assert.equal(r.status, 403, host);
      }
      r = await call(
        app.port,
        {
          method: "POST",
          path: "/api/commands",
          headers: {
            host: "127.0.0.1:3100",
            origin: "https://hotori.onrender.com",
            "content-type": "application/json",
          },
        },
        "{}",
      );
      assert.equal(r.status, 403);
    } finally {
      await app.close();
    }
  });
});
it("PostgreSQL 거래: 마지막1실 동시예약, 멱등, 실패롤백, 변경충돌, 취소재고복구, 재시작지속성", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "hotori-test-"));
  let store = await openStore(dir, clock);
  try {
    const [a, b] = await Promise.allSettled([
      store.command(command("reservation.create", booking())),
      store.command(command("reservation.create", booking())),
    ]);
    assert.equal([a, b].filter((r) => r.status === "fulfilled").length, 1);
    assert.equal([a, b].filter((r) => r.status === "rejected").length, 1);
    const successful = [a, b].find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<{ id?: string }>;
    const view = await store.state();
    const reservation = view.reservations.find(
      (r) => r.id === successful.value.id,
    )!;
    const before = JSON.stringify(view.reservations);
    await assert.rejects(
      store.command(
        command("reservation.update", {
          ...reservation,
          typeId: "standard",
          quantity: 1000,
        }),
      ),
      errorCode("SOLD_OUT"),
    );
    assert.equal(JSON.stringify((await store.state()).reservations), before);
    const cmd = command("property.update", { name: "지속성 검증 호텔" });
    const once = await store.command(cmd);
    const twice = await store.command(cmd);
    assert.deepEqual(twice, once);
    await assert.rejects(
      store.command({ ...cmd, data: { name: "다른 요청" } }),
      errorCode("IDEMPOTENCY_CONFLICT"),
    );
    await assert.rejects(
      store.command(
        command("reservation.cancel", { id: reservation.id, version: 999 }),
      ),
      errorCode("VERSION_CONFLICT"),
    );
    await store.command(
      command("reservation.cancel", {
        id: reservation.id,
        version: reservation.version,
      }),
    );
    const next = await store.command(command("reservation.create", booking()));
    assert.ok(next.id);
    const revision = (await store.state()).revision;
    await store.close();
    store = await openStore(dir, clock);
    assert.equal((await store.state()).property.name, "지속성 검증 호텔");
    assert.equal((await store.state()).revision, revision);
    assert.deepEqual(await store.command(cmd), once);
    assert.equal(
      (await store.state()).audit.filter((a) => a.action === "property.update")
        .length,
      1,
    );
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
