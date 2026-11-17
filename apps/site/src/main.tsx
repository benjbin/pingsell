import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { LANG } from "./i18n";

// index.html ships the French title and meta tags; swap them for English visitors.
if (LANG === "en") {
  document.title = "Pingsell — Email marketing that sells, without giving up your evenings";
  const setMeta = (selector: string, content: string) => document.querySelector(selector)?.setAttribute("content", content);
  setMeta(
    'meta[name="description"]',
    "Create beautiful emails, target the right customers and automate your follow-ups. Pingsell is the email marketing tool built for online stores, billed by email volume.",
  );
  setMeta('meta[property="og:title"]', "Pingsell — Emails that sell");
  setMeta(
    'meta[property="og:description"]',
    "Visual editor, segments, automations and team. Billed by email volume, not by number of contacts.",
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
