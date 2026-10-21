"use client";

import { useEffect, useRef, useState } from "react";
import { IDLE_MINUTES } from "@/lib/session-config";

const KEY = "hb_last_activity";
const WARN_MS = 2 * 60_000;
const PING_MS = 5 * 60_000;

/**
 * Loggar ut efter IDLE_MINUTES utan aktivitet (mus, tangentbord, scroll, touch). Aktiviteten delas mellan flikar
 * via localStorage, och servern får en signal var femte minut medan man är aktiv så att sessionen hålls vid liv.
 */
export function IdleLogout() {
  const [left, setLeft] = useState<number | null>(null);
  const keepAlive = useRef<() => void>(() => {});

  useEffect(() => {
    const limit = IDLE_MINUTES * 60_000;
    let last = Date.now();
    let lastMark = 0;
    let lastPing = Date.now();
    let done = false;

    const expire = () => {
      if (done) return;
      done = true;
      window.location.href = "/logout?expired=1";
    };
    const latest = () => {
      try {
        return Math.max(last, Number(localStorage.getItem(KEY)) || 0);
      } catch {
        return last;
      }
    };
    const ping = () => {
      lastPing = Date.now();
      fetch("/api/session", { method: "POST" })
        .then((r) => r.status === 401 && expire())
        .catch(() => {});
    };
    const mark = (force = false) => {
      const now = Date.now();
      if (!force && now - lastMark < 5_000) return; // musrörelser kommer tätt
      lastMark = now;
      last = now;
      try {
        localStorage.setItem(KEY, String(now));
      } catch {}
      if (force || now - lastPing > PING_MS) ping();
    };
    const check = () => {
      const idle = Date.now() - latest();
      if (idle >= limit) expire();
      else setLeft(idle >= limit - WARN_MS ? Math.ceil((limit - idle) / 1000) : null);
    };
    keepAlive.current = () => {
      mark(true);
      setLeft(null);
    };

    const onActivity = () => mark();
    const onVisible = () => document.visibilityState === "visible" && check();
    const events = ["pointerdown", "pointermove", "keydown", "scroll", "touchstart", "wheel"] as const;
    for (const e of events) window.addEventListener(e, onActivity, { passive: true, capture: true });
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(check, 1_000);
    return () => {
      for (const e of events) window.removeEventListener(e, onActivity, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, []);

  if (left === null) return null;
  const m = Math.floor(left / 60);
  const s = String(left % 60).padStart(2, "0");
  return (
    <div role="alertdialog" aria-live="assertive" className="no-print fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-4 rounded-2xl bg-surface p-4 shadow-2xl ring-1 ring-line">
      <div className="min-w-0 flex-1 text-[14px]">
        <p className="font-semibold">Du loggas snart ut</p>
        <p className="text-muted">
          Ingen aktivitet på en stund. Utloggning om <span className="tabular-nums">{m}:{s}</span>.
        </p>
      </div>
      <button type="button" className="btn-primary shrink-0" onClick={() => keepAlive.current()}>
        Fortsätt
      </button>
    </div>
  );
}
