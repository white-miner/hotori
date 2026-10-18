import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 3100);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT 환경 변수가 올바르지 않습니다.");
const accessPassword = process.env.HOTORI_ACCESS_PASSWORD || undefined;

const app = createApp({ accessPassword, distDir: path.join(root, "dist") });
const server = app.listen(port, host, () =>
  console.log(`HOTORI v3 http://${host}:${port}${accessPassword ? " · 공용 비밀번호 켜짐" : ""}`),
);
const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
