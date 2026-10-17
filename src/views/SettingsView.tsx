import { useState } from "react";
import {
  Check,
  LogIn,
  LogOut,
  LockKeyhole,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { AppState } from "../../shared/types";
import { ColorPicker } from "../components/ui";
import { type CommandFn, floorsOf, roleLabels, wonSign } from "../lib";

type Section = "hotel" | "hourly" | "colors" | "rooms" | "team" | "plan";
const SECTIONS: { id: Section; label: string }[] = [
  { id: "hotel", label: "호텔 정보" },
  { id: "hourly", label: "대실 · 요금" },
  { id: "colors", label: "층 · 특수객실 색" },
  { id: "rooms", label: "객실 등록" },
  { id: "team", label: "팀 · 근무" },
  { id: "plan", label: "플랜" },
];
export function SettingsView({
  s,
  busy,
  command,
  onRoomCreate,
  onMember,
  onOpenRoom,
  initial = "hotel",
}: {
  s: AppState;
  busy: boolean;
  command: CommandFn;
  onRoomCreate: () => void;
  onMember: () => void;
  onOpenRoom: (roomId: string) => void;
  initial?: Section;
}) {
  const [sec, setSec] = useState<Section>(initial);
  const keep = { close: false };
  return (
    <div className="page settings">
      <div className="page-head">
        <div>
          <h1>설정</h1>
          <p>호텔에 맞게 대실 요금, 층 색, 객실과 팀을 정리해요.</p>
        </div>
      </div>
      <div className="set-layout">
        <nav className="set-nav" aria-label="설정 메뉴">
          {SECTIONS.map((x) => (
            <button
              type="button"
              key={x.id}
              className={sec === x.id ? "on" : ""}
              aria-current={sec === x.id}
              onClick={() => setSec(x.id)}
            >
              {x.label}
            </button>
          ))}
        </nav>
        <div className="set-body">
          {sec === "hotel" && (
            <section className="card">
              <h2>호텔 기본 정보</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void command(
                    "property.update",
                    { name: new FormData(e.currentTarget).get("hotelName") },
                    keep,
                  );
                }}
              >
                <label className="flabel2">
                  호텔 이름
                  <input
                    name="hotelName"
                    key={s.property.name}
                    defaultValue={s.property.name}
                    required
                    maxLength={60}
                  />
                </label>
                <dl className="facts">
                  <div>
                    <dt>기준 시간대</dt>
                    <dd>서울 (Asia/Seoul)</dd>
                  </div>
                  <div>
                    <dt>영업일</dt>
                    <dd>
                      매일 {String(s.businessDayCutoffHour).padStart(2, "0")}
                      :00에 넘어가요 (자정~06시는 전날 영업일)
                    </dd>
                  </div>
                  <div>
                    <dt>호텔 유형</dt>
                    <dd>
                      {s.property.demo ? "체험용 데모 호텔" : "운영 호텔"}
                    </dd>
                  </div>
                </dl>
                <div className="form-actions">
                  <button className="btn solid" disabled={busy}>
                    이름 저장
                  </button>
                </div>
              </form>
            </section>
          )}
          {sec === "hourly" && (
            <HourlySettings s={s} busy={busy} command={command} />
          )}
          {sec === "colors" && (
            <section className="card">
              <h2>층 색 · 특수객실 색</h2>
              <p className="helper">
                층 색은 건물 화면의 층 번호와 바탕, 시간표의 층 제목에 들어가요.
                특수객실 색은 방 칸 왼쪽 띠와 이름표, 시간표 방 번호 옆 표시로만
                보여서 상태 무늬를 가리지 않아요.
              </p>
              {floorsOf(s).map((g) => (
                <div key={g.building} className="color-building">
                  {floorsOf(s).length > 1 && <h3>{g.building}</h3>}
                  {g.floors.map((f) => (
                    <div
                      key={f.key}
                      className="color-floor"
                      style={
                        f.color
                          ? ({
                              ["--fc" as string]: f.color,
                            } as React.CSSProperties)
                          : undefined
                      }
                    >
                      <div className="cf-head">
                        <b className="num cf-no">{f.floor}F</b>
                        <ColorPicker
                          label={`${f.floor}층 색`}
                          value={f.color}
                          disabled={busy}
                          onChange={(hex) =>
                            void command(
                              "floor.update",
                              {
                                building: g.building,
                                floor: f.floor,
                                color: hex,
                              },
                              keep,
                            )
                          }
                        />
                      </div>
                      <div className="cf-rooms">
                        {f.rooms.map((r) => (
                          <button
                            type="button"
                            key={r.id}
                            className={`cf-room ${r.color ? "tinted" : ""}`}
                            style={
                              r.color
                                ? ({
                                    ["--rcol" as string]: r.color,
                                  } as React.CSSProperties)
                                : undefined
                            }
                            onClick={() => onOpenRoom(r.id)}
                          >
                            <b className="num">{r.number}</b>
                            <span>
                              {r.label ||
                                s.roomTypes.find((t) => t.id === r.typeId)
                                  ?.name}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
              <p className="helper">
                방을 누르면 그 방의 색과 이름표(예: 스위트, 월풋, 반려동물)를
                바로 고를 수 있어요.
              </p>
            </section>
          )}
          {sec === "rooms" && (
            <section className="card">
              <div className="card-head">
                <h2>객실 등록 현황</h2>
                <button
                  type="button"
                  className="btn solid"
                  onClick={onRoomCreate}
                >
                  <Plus size={16} />
                  객실 등록
                </button>
              </div>
              <div className="usage">
                <b className="num">{s.rooms.length}</b>
                <span> / {s.limits.maxRooms ?? "제한 없음"}실</span>
              </div>
              <div className="usage-track">
                <i
                  style={{
                    width: `${Math.min(100, (s.rooms.length / (s.limits.maxRooms || Math.max(20, s.rooms.length))) * 100)}%`,
                  }}
                />
              </div>
              <p className="helper">
                판매 중지 객실도 등록 수에 들어가요. 객실 타입:{" "}
                {s.roomTypes
                  .map((t) => `${t.name} 숙박 ${wonSign(t.baseRate)}`)
                  .join(" · ")}
              </p>
            </section>
          )}
          {sec === "team" && (
            <section className="card">
              <div className="card-head">
                <h2>팀 · 근무 기록</h2>
                <button type="button" className="btn solid" onClick={onMember}>
                  <Plus size={16} />
                  구성원 등록
                </button>
              </div>
              <p className="helper">
                실제 초대와 계정 연결은 아직 없어요. 등록된 구성원으로 근무
                기록을 체험할 수 있어요.
                {s.plan === "free" && " 출퇴근 기록은 프로 플랜 기능이에요."}
              </p>
              <div className="members">
                {s.members.map((m) => {
                  const active = s.attendance.find(
                    (a) => a.memberId === m.id && !a.clockOut,
                  );
                  return (
                    <div key={m.id} className="member">
                      <span className="gc-avatar">{m.name.slice(0, 1)}</span>
                      <div>
                        <b>{m.name}</b>
                        <small>{roleLabels[m.role]}</small>
                      </div>
                      {active && (
                        <span className="pill-s green">
                          근무 중 ·{" "}
                          {new Date(active.clockIn).toLocaleTimeString(
                            "ko-KR",
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                              timeZone: "Asia/Seoul",
                            },
                          )}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy || (!active && !s.limits.attendance)}
                        onClick={() =>
                          void command(
                            active
                              ? "attendance.clockout"
                              : "attendance.clockin",
                            active ? { id: active.id } : { memberId: m.id },
                            keep,
                          )
                        }
                      >
                        {active ? <LogOut size={13} /> : <LogIn size={13} />}
                        {active ? "퇴근 기록" : "출근 기록"}
                        {!active && !s.limits.attendance && (
                          <LockKeyhole size={12} />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
              <h3 className="sub-h">최근 근무 기록</h3>
              {s.attendance.length ? (
                s.attendance
                  .slice()
                  .reverse()
                  .map((a) => (
                    <div className="att" key={a.id}>
                      <b>{s.members.find((m) => m.id === a.memberId)?.name}</b>
                      <span>
                        {new Date(a.clockIn).toLocaleString("ko-KR", {
                          timeZone: "Asia/Seoul",
                        })}
                      </span>
                      <span>
                        {a.clockOut
                          ? new Date(a.clockOut).toLocaleString("ko-KR", {
                              timeZone: "Asia/Seoul",
                            })
                          : "근무 중"}
                      </span>
                    </div>
                  ))
              ) : (
                <p className="quiet">아직 근무 기록이 없어요.</p>
              )}
            </section>
          )}
          {sec === "plan" && (
            <section className="card">
              <div className="card-head">
                <h2>호텔과 함께 자라는 플랜</h2>
                <span
                  className={`pill-s ${s.plan === "pro" ? "blue" : "neutral"}`}
                >
                  현재 {s.plan === "pro" ? "PRO" : "FREE"}
                </span>
              </div>
              <div className="plans">
                <div className={`plan ${s.plan === "free" ? "on" : ""}`}>
                  <span className="plan-l">FREE</span>
                  <h3>기본 운영의 시작</h3>
                  <div className="plan-p">무료</div>
                  <ul>
                    {[
                      "과거·미래 각각 1개월 예약",
                      "하루 단위 판매금액",
                      "객실별 미해결 기록 1개",
                      "객실 등록 20실 · 구성원 등록",
                    ].map((x) => (
                      <li key={x}>
                        <Check size={14} />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`plan ${s.plan === "pro" ? "on" : ""}`}>
                  <span className="plan-l">
                    PRO <Sparkles size={12} />
                  </span>
                  <h3>더 넓게 보는 호텔 운영</h3>
                  <div className="plan-p">
                    30,000<small>원 / 월 · 예정</small>
                  </div>
                  <ul>
                    {[
                      "과거·미래 각각 6개월 예약",
                      "기간별 판매금액 집계",
                      "객실별 미해결 기록 30개",
                      "객실·건물동 수 제한 없음",
                      "구성원 출퇴근 기록",
                    ].map((x) => (
                      <li key={x}>
                        <Check size={14} />
                        {x}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <div className="plan-demo">
                <div>
                  <b>
                    <Sparkles size={15} /> 플랜 체험
                  </b>
                  <p>
                    실제 결제 없이 데모 호텔의 기능 제한을 바꿔요. 플랜을 바꿔도
                    저장된 데이터는 지워지지 않아요.
                  </p>
                </div>
                <div className="seg2">
                  <button
                    type="button"
                    disabled={busy || s.plan === "free"}
                    className={s.plan === "free" ? "on" : ""}
                    onClick={() =>
                      void command("demo.plan", { plan: "free" }, keep)
                    }
                  >
                    무료 체험
                  </button>
                  <button
                    type="button"
                    disabled={busy || s.plan === "pro"}
                    className={s.plan === "pro" ? "on" : ""}
                    onClick={() =>
                      void command("demo.plan", { plan: "pro" }, keep)
                    }
                  >
                    프로 체험
                  </button>
                </div>
              </div>
              <div className="bounds">
                <ShieldCheck size={18} />
                <p>
                  지금 보고 있는 것은 작동하는 초안이에요. 예약·객실·인수인계
                  변경은 데모 호텔에 저장돼요. 실제 로그인, 직원 초대, 결제와
                  외부 예약 연동은 아직 없고, 실제 손님 정보는 입력하지 마세요.
                </p>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function HourlySettings({
  s,
  busy,
  command,
}: {
  s: AppState;
  busy: boolean;
  command: CommandFn;
}) {
  const o = s.settings;
  return (
    <section className="card">
      <h2>대실 · 입퇴실 시간</h2>
      <p className="helper">
        대실은 방 타입마다 기본 시간까지 정액이고, 그보다 길면 1시간마다 추가
        요금이 붙어요. 금액은 체크인할 때 바꿀 수도 있어요.
      </p>
      <form
        key={JSON.stringify(o) + s.roomTypes.map((t) => t.hourlyRate).join()}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const num = (k: string) => Math.round(Number(f.get(k)));
          void command(
            "settings.update",
            {
              baseHours: num("baseHours"),
              extraHourFee: num("extraHourFee"),
              cleaningMinutes: num("cleaningMinutes"),
              checkInTime: f.get("checkInTime"),
              checkOutTime: f.get("checkOutTime"),
              hourlyRates: Object.fromEntries(
                s.roomTypes.map((t) => [t.id, num(`rate-${t.id}`)]),
              ),
            },
            { close: false },
          );
        }}
      >
        <div className="fields three">
          <label className="flabel2">
            대실 기본 시간
            <span className="unit">
              <input
                name="baseHours"
                type="number"
                min={1}
                max={12}
                required
                defaultValue={o.baseHours}
              />
              시간
            </span>
          </label>
          <label className="flabel2">
            넘는 1시간 추가 요금
            <span className="unit">
              <input
                name="extraHourFee"
                type="number"
                min={0}
                step={1000}
                required
                defaultValue={o.extraHourFee}
              />
              원
            </span>
          </label>
          <label className="flabel2">
            퇴실 뒤 청소 시간
            <span className="unit">
              <input
                name="cleaningMinutes"
                type="number"
                min={0}
                max={240}
                step={5}
                required
                defaultValue={o.cleaningMinutes}
              />
              분
            </span>
          </label>
        </div>
        <h3 className="sub-h">방 타입별 대실 요금 (기본 {o.baseHours}시간)</h3>
        <div className="fields three">
          {s.roomTypes.map((t) => (
            <label className="flabel2" key={t.id}>
              {t.name}
              <span className="unit">
                <input
                  name={`rate-${t.id}`}
                  type="number"
                  min={0}
                  step={1000}
                  required
                  defaultValue={t.hourlyRate ?? 0}
                />
                원
              </span>
            </label>
          ))}
        </div>
        <h3 className="sub-h">숙박 입실 · 퇴실 시각</h3>
        <div className="fields three">
          <label className="flabel2">
            입실
            <input
              name="checkInTime"
              type="time"
              required
              defaultValue={o.checkInTime}
            />
          </label>
          <label className="flabel2">
            퇴실
            <input
              name="checkOutTime"
              type="time"
              required
              defaultValue={o.checkOutTime}
            />
          </label>
        </div>
        <div className="form-actions">
          <button className="btn solid" disabled={busy}>
            설정 저장
          </button>
        </div>
      </form>
    </section>
  );
}
