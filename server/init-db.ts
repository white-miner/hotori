// Build-time step: create the empty PostgreSQL data folder once (initdb).
// initdb is the memory-heavy part of PGlite (~700MB peak), so running it during the build
// (more RAM) lets the 512MB server start by just opening the folder. Tables and demo data
// are still created when the server starts, so the demo dates stay current.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { pgliteOptions } from "./store.js";
const workspace = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const dataDir = path.join(workspace, ".hotori-data", "postgres");
if (existsSync(path.join(dataDir, "PG_VERSION"))) {
  console.log("HOTORI 데이터 폴더가 이미 있어 초기화를 건너뜁니다.");
} else {
  mkdirSync(dataDir, { recursive: true });
  const db = await PGlite.create(dataDir, pgliteOptions);
  await db.close();
  console.log("HOTORI 데이터 폴더를 미리 만들었습니다: .hotori-data/postgres");
}
