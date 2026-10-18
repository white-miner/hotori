import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

// v3: 데이터와 로그인은 Supabase가 맡아요. 이 서버는 빌드된 화면(dist)만 보내 줘요.
// HOTORI_ACCESS_PASSWORD가 있으면 예전처럼 공용 비밀번호(Basic Auth)를 한 번 더 걸고, 없으면 걸지 않아요.
export interface AppOptions {
  accessPassword?: string;
  distDir: string;
}

export function passwordMatches(authorization: string | undefined, password: string): boolean {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(authorization ?? "");
  if (!match) return false;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  if (colon < 0) return false;
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(decoded.slice(colon + 1)), digest(password));
}

export function createApp({ accessPassword, distDir }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    if (
      accessPassword &&
      !(req.method === "GET" && req.path === "/api/health") &&
      !passwordMatches(req.headers.authorization, accessPassword)
    ) {
      res.setHeader("WWW-Authenticate", 'Basic realm="HOTORI", charset="UTF-8"');
      return res.status(401).send("호토리 접속 비밀번호가 필요합니다.");
    }
    next();
  });
  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, version: 3, gate: accessPassword ? "basic-auth" : "none" }),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "NOT_FOUND" }));
  if (existsSync(path.join(distDir, "index.html"))) {
    app.use(
      "/assets",
      express.static(path.join(distDir, "assets"), {
        setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=31536000, immutable"),
      }),
    );
    app.use(
      express.static(distDir, {
        setHeaders: (res, file) => {
          if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== "GET") return next();
      res.setHeader("Cache-Control", "no-cache");
      res.sendFile(path.join(distDir, "index.html"));
    });
  }
  return app;
}
