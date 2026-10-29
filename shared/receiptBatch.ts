import type { CreatePaymentLine } from "./payment";

export type ReceiptBatchLine = CreatePaymentLine & { id: string; bookingId?: string | null; groupId?: string | null; bizDate: string; note?: string | null };
export function receiptBatch(owner: { bookingId?: string | null; groupId?: string | null }, lines: CreatePaymentLine[], bizDate: string): ReceiptBatchLine[] {
  if (!!owner.bookingId === !!owner.groupId) throw new Error("수납 대상은 예약 또는 단체 하나여야 해요.");
  return lines.map((p) => ({ ...p, ...owner, bizDate, id: crypto.randomUUID() }));
}

/** 응답 불명 재시도 시 같은 UUID가 다른 수납을 덮어쓰지 않는지 확인한다. */
export function verifyReceiptBatch(wanted: ReceiptBatchLine[], actual: { id: string; bookingId?: string | null; groupId?: string | null; kind: string; method: string; amount: number; bizDate: string; note?: string | null }[]): boolean {
  return wanted.length > 0 && wanted.every((w) => actual.some((a) => a.id === w.id && (a.bookingId || null) === (w.bookingId || null) && (a.groupId || null) === (w.groupId || null) && a.kind === w.kind && a.method === w.method && a.amount === w.amount && a.bizDate === w.bizDate && (a.note ?? null) === (w.note ?? null)));
}

/** 저장 응답이 끊겨도 전체 행 조회로 확정한다. 조회 실패·부분 확인은 성공으로 취급하지 않는다. */
export async function writeVerifiedReceiptBatch<T extends Parameters<typeof verifyReceiptBatch>[1][number]>(wanted: ReceiptBatchLine[], write: () => Promise<void>, read: () => Promise<T[]>): Promise<T[]> {
  let failure: unknown;
  try { await write(); } catch (e) { failure = e; }
  const actual = await read();
  if (!verifyReceiptBatch(wanted, actual)) throw failure ?? new Error("수납 일부를 확인하지 못했어요. 같은 수납으로 다시 시도해 주세요.");
  return actual;
}
