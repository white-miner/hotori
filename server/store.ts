import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import type { Command, CommandResult } from "../shared/types.js";
import {
  DomainError,
  mutate,
  report,
  seed,
  snapshot,
  todayKST,
  type DatabaseState,
} from "./domain.js";
// One trusted hotel, one process, one PostgreSQL aggregate row. Every read/write
// shares this queue; failed mutations never publish partial in-memory state.
// Small-memory PostgreSQL settings so the whole server fits a 512MB host (Render free).
// The hotel data is one small JSONB row, so tiny buffers do not change behavior.
export const pgliteOptions = {
  startParams: [
    ...PGlite.defaultStartParams,
    "-c",
    "shared_buffers=16MB",
    "-c",
    "work_mem=2MB",
    "-c",
    "maintenance_work_mem=8MB",
    "-c",
    "temp_buffers=2MB",
    "-c",
    "wal_buffers=1MB",
  ],
};
export async function openStore(
  dataDir?: string,
  clock: () => Date = () => new Date(),
) {
  const db = await PGlite.create(dataDir, pgliteOptions);
  await db.exec(
    `CREATE TABLE IF NOT EXISTS hotel_state (id integer PRIMARY KEY CHECK (id=1), payload jsonb NOT NULL); CREATE TABLE IF NOT EXISTS command_requests (request_id text PRIMARY KEY, fingerprint text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());`,
  );
  await db.query(
    "INSERT INTO hotel_state(id,payload) VALUES(1,$1::jsonb) ON CONFLICT(id) DO NOTHING",
    [JSON.stringify(seed(todayKST(clock())))],
  );
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const task = queue.then(work, work);
    queue = task.catch(() => {});
    return task;
  };
  const load = async () => {
    const result = await db.query<{ payload: DatabaseState }>(
      "SELECT payload FROM hotel_state WHERE id=1",
    );
    return result.rows[0].payload;
  };
  return {
    state: (date?: string) =>
      serialized(async () => {
        const instant = clock();
        const today = todayKST(instant);
        return snapshot(
          await load(),
          date ?? today,
          today,
          instant.toISOString(),
        );
      }),
    report: (start: string, end: string) =>
      serialized(async () =>
        report(await load(), start, end, todayKST(clock())),
      ),
    command: (cmd: Command) =>
      serialized(async () => {
        if (
          !cmd ||
          typeof cmd.type !== "string" ||
          typeof cmd.requestId !== "string" ||
          !/^[a-zA-Z0-9_-]{8,100}$/.test(cmd.requestId)
        )
          throw new DomainError(
            "INVALID_REQUEST_ID",
            "요청 식별자는 8~100자의 영문·숫자·대시여야 합니다.",
          );
        const fingerprint = createHash("sha256")
          .update(JSON.stringify({ type: cmd.type, data: cmd.data }))
          .digest("hex");
        return db.transaction(async (tx) => {
          const previous = await tx.query<{
            fingerprint: string;
            result: CommandResult;
          }>(
            "SELECT fingerprint,result FROM command_requests WHERE request_id=$1",
            [cmd.requestId],
          );
          if (previous.rows.length) {
            if (previous.rows[0].fingerprint !== fingerprint)
              throw new DomainError(
                "IDEMPOTENCY_CONFLICT",
                "같은 요청 식별자를 다른 내용으로 다시 사용할 수 없습니다.",
                409,
              );
            return previous.rows[0].result;
          }
          const result = await tx.query<{ payload: DatabaseState }>(
            "SELECT payload FROM hotel_state WHERE id=1 FOR UPDATE",
          );
          const state = result.rows[0].payload;
          const instant = clock();
          const response = mutate(
            state,
            cmd,
            todayKST(instant),
            instant.toISOString(),
          );
          await tx.query(
            "UPDATE hotel_state SET payload=$1::jsonb WHERE id=1",
            [JSON.stringify(state)],
          );
          await tx.query(
            "INSERT INTO command_requests(request_id,fingerprint,result) VALUES($1,$2,$3::jsonb)",
            [cmd.requestId, fingerprint, JSON.stringify(response)],
          );
          return response;
        });
      }),
    close: () => serialized(() => db.close()),
  };
}
export type Store = Awaited<ReturnType<typeof openStore>>;
