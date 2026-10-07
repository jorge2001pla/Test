"use client";

import { useEffect, useState } from "react";

/** Tiny confirmation toast. Components fire `window.dispatchEvent(new CustomEvent("prc-toast", { detail }))`
 * so the message survives even when the row that triggered it disappears from the queue. */
export default function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onToast = (e: Event) => {
      setMsg(String((e as CustomEvent).detail ?? ""));
      clearTimeout(timer);
      timer = setTimeout(() => setMsg(null), 7000);
    };
    window.addEventListener("prc-toast", onToast);
    return () => {
      window.removeEventListener("prc-toast", onToast);
      clearTimeout(timer);
    };
  }, []);

  if (!msg) return null;
  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-sm rounded-lg border border-gold bg-card px-4 py-3 text-sm text-foreground shadow-xl" role="status">
      {msg}
      <button type="button" onClick={() => setMsg(null)} className="ml-3 text-muted-foreground hover:text-foreground" aria-label="Dismiss">✕</button>
    </div>
  );
}
