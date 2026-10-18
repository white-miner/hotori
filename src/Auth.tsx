import { useState } from "react";
import { supabase } from "./supabase";
import { Brand } from "./ui";

const MSG: Record<string, string> = {
  "Invalid login credentials": "이메일이나 비밀번호가 맞지 않아요.",
  "Email not confirmed": "메일함에서 인증 링크를 먼저 눌러 주세요.",
  "User already registered": "이미 가입된 이메일이에요. 로그인해 주세요.",
};
const ko = (m: string) => {
  if (MSG[m]) return MSG[m];
  if (/password/i.test(m)) return "비밀번호는 6자 이상이어야 해요.";
  if (/rate limit|too many/i.test(m)) return "잠시 뒤에 다시 시도해 주세요.";
  if (/email/i.test(m) && /invalid|valid/i.test(m)) return "이메일 주소를 다시 확인해 주세요.";
  if (/fetch|network/i.test(m)) return "인터넷 연결을 확인해 주세요.";
  return /[가-힣]/.test(m) ? m : `문제가 생겼어요. 잠시 뒤 다시 시도해 주세요. (${m})`;
};

export default function AuthScreen() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [hotel, setHotel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; ok?: boolean } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
        if (error) throw error;
      } else {
        if (!hotel.trim()) throw new Error("호텔 이름을 적어 주세요.");
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: pw,
          options: { data: { hotel_name: hotel.trim() }, emailRedirectTo: location.origin },
        });
        if (error) throw error;
        if (!data.session) setMsg({ t: `${email.trim()}로 인증 메일을 보냈어요. 메일의 링크를 누르면 바로 시작돼요.`, ok: true });
      }
    } catch (err) {
      setMsg({ t: ko(err instanceof Error ? err.message : String(err)) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <Brand />
        <h1>{mode === "login" ? "호토리 로그인" : "우리 호텔 장부 만들기"}</h1>
        <p className="sub">여러 플랫폼 예약을 한 장부에 적고, 남은 객실을 한눈에 봐요.</p>
        <div className="seg wide">
          <button type="button" className={mode === "login" ? "on" : ""} onClick={() => setMode("login")}>
            로그인
          </button>
          <button type="button" className={mode === "signup" ? "on" : ""} onClick={() => setMode("signup")}>
            가입하기
          </button>
        </div>
        {mode === "signup" ? (
          <label className="af">
            <span>호텔 이름</span>
            <input className="inp" value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="예: 경주 스타즈 호텔" maxLength={60} />
          </label>
        ) : null}
        <label className="af">
          <span>이메일</span>
          <input className="inp" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="af">
          <span>비밀번호</span>
          <input
            className="inp"
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={6}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        {msg ? <div className={`amsg ${msg.ok ? "ok" : ""}`}>{msg.t}</div> : null}
        <button className="btn red big" disabled={busy}>
          {busy ? "잠시만요…" : mode === "login" ? "로그인" : "가입하고 시작하기"}
        </button>
        <p className="fine">처음 가입하면 Free 요금제로 시작해요. 같은 계정으로 PC·태블릿·휴대폰에서 동시에 쓸 수 있어요.</p>
      </form>
    </div>
  );
}
