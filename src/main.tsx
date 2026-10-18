import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import SharedView from "./Shared";
import "./styles.css";

// 현황 공유 링크: /s/<토큰>
const SHARE = /^\/s\/([^/]+)\/?$/.exec(location.pathname)?.[1] ?? null;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {SHARE ? <SharedView token={SHARE} /> : <App />}
  </React.StrictMode>,
);
