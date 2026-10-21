/** Format Supabase / thrown save failures for UI (never swallow into a bare string). */
export function saveFailMessage(e: unknown, fallback = "저장하지 못했어요"): string {
  const pick = (o: { message?: unknown; code?: unknown; details?: unknown; hint?: unknown }) => {
    const msg = typeof o.message === "string" ? o.message.trim() : "";
    const code = typeof o.code === "string" ? o.code.trim() : "";
    const details = typeof o.details === "string" ? o.details.trim() : "";
    const hint = typeof o.hint === "string" ? o.hint.trim() : "";
    const bits = [msg, code ? `[${code}]` : "", details, hint].filter(Boolean);
    if (!bits.length) return fallback;
    return `${fallback}: ${bits.join(" · ").slice(0, 280)}`;
  };
  if (e instanceof Error) {
    return pick(e as Error & { code?: string; details?: string; hint?: string });
  }
  if (e && typeof e === "object" && "message" in e) {
    return pick(e as { message?: unknown; code?: unknown; details?: unknown; hint?: unknown });
  }
  return fallback;
}
