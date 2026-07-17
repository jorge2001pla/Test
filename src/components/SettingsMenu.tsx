"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

export default function SettingsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Settings"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 text-header-foreground/80 transition-colors hover:border-gold hover:text-gold"
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor" className="h-4.5 w-4.5">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 13.5a7.5 7.5 0 0 0 0-3l1.9-1.5-2-3.4-2.3.9a7.5 7.5 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5a7.5 7.5 0 0 0-2.6 1.5l-2.3-.9-2 3.4L4.6 10.5a7.5 7.5 0 0 0 0 3l-1.9 1.5 2 3.4 2.3-.9a7.5 7.5 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.5 7.5 0 0 0 2.6-1.5l2.3.9 2-3.4-1.9-1.5Z" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-20 min-w-[12rem] rounded-lg border border-border bg-card py-1 shadow-lg">
          <Link
            href="/promotions"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-foreground hover:bg-gold/10 hover:text-gold"
          >
            Promotions
          </Link>
          <Link
            href="/import"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-foreground hover:bg-gold/10 hover:text-gold"
          >
            Import Clients
          </Link>
          <Link
            href="/import-values"
            onClick={() => setOpen(false)}
            className="block px-4 py-2 text-sm text-foreground hover:bg-gold/10 hover:text-gold"
          >
            Import Client Values
          </Link>
          <a
            href="/api/export-book"
            className="block px-4 py-2 text-sm text-foreground hover:bg-gold/10 hover:text-gold"
          >
            Export Book (CSV)
          </a>
          <div className="mt-1 flex items-center justify-between border-t border-border px-4 py-2">
            <span className="text-sm text-foreground">Theme</span>
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
  );
}
