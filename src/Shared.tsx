import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { addDays } from "../shared/ledger";
import { type HotelData, type SharedStatus, fetchShared } from "./data";
import { Brand } from "./ui";
import Dashboard from "./Dashboard";

const POLL_MS = 30000;

/** /s/<토큰> : 로그인 없이 보는 현황판 (보기 전용) */
export default function SharedView({ token }: { token: string }) {
  const [st, setSt] = useState<SharedStatus | null | undefined>(undefined);
  const [err, setErr] = useState<string | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [selDate, setSelDate] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const r = await fetchShared(token);
      setSt(r);
      setErr(null);
      setAt(new Date());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오지 못했어요");
    } finally {
      setBusy(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (st === undefined) return <div className="center-msg">{err ? `불러오지 못했어요: ${err}` : "현황을 불러오는 중…"}</div>;
  if (st === null)
    return (
      <div className="center-msg">
        <b>이 링크는 지금 쓸 수 없어요</b>
        <span className="muted">공유가 꺼졌거나 새 링크로 바뀌었어요. 호텔에 새 링크를 요청해 주세요.</span>
      </div>
    );

  const today = st.today;
  const data = {
    hotel: { id: "shared", name: st.name, plan: "pro", isDemo: false, settings: st.settings },
    bookings: st.bookings,
    error: null,
    patchBooking: async () => {
      throw new Error("보기 전용이에요");
    },
    confirmTentative: async () => {
      throw new Error("보기 전용이에요");
    },
  } as unknown as HotelData;
  const time = at ? at.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div className="app shared">
      <header className="top">
        <Brand sub={st.name} />
        <span className="demo">보기 전용</span>
        <div className="right">
          <span className="muted sm sync">{err ? "연결 확인 중" : `${time} 기준 · 30초마다 새로 고침`}</span>
          <button className="btn line sm" onClick={() => void load()} disabled={busy} aria-label="새로 고침">
            <RefreshCw size={14} className={busy ? "spin" : ""} />
            새로 고침
          </button>
        </div>
      </header>
      <Dashboard
        data={data}
        today={today}
        selDate={selDate ?? today}
        setSelDate={setSelDate}
        onOpen={() => {}}
        onNew={() => {}}
        notify={() => {}}
        readOnly
        minDate={addDays(today, -1)}
        maxDate={addDays(today, 13)}
      />
    </div>
  );
}
