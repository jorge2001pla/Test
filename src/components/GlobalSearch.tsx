"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  id: string;
  name: string;
  phone: string | null;
  kind: "book" | "client";
  status: string;
  href: string;
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { results: SearchResult[] };
        setResults(data.results);
        setHighlighted(0);
        setOpen(true);
      } catch {
        // network hiccup — leave the previous results in place
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function go(result: SearchResult) {
    setOpen(false);
    setQuery("");
    router.push(result.href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[highlighted]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search clients…"
        aria-label="Search clients by name or phone"
        className="w-40 rounded-full border border-white/15 bg-transparent px-3.5 py-1.5 text-sm text-header-foreground placeholder:text-header-foreground/50 focus:w-56 focus:border-gold focus:outline-none transition-[width,border-color] sm:w-44"
      />

      {open && (
        <div className="absolute right-0 top-10 z-30 w-72 overflow-hidden rounded-lg border border-border bg-card shadow-lg">
          {results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No one matches that.</p>
          ) : (
            <ul>
              {results.map((r, i) => (
                <li key={`${r.kind}-${r.id}`}>
                  <button
                    type="button"
                    onClick={() => go(r)}
                    onMouseEnter={() => setHighlighted(i)}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                      i === highlighted ? "bg-gold/10" : ""
                    }`}
                  >
                    <span>
                      <span className="block font-medium text-foreground">{r.name}</span>
                      <span className="block text-xs text-muted-foreground">{r.phone ?? "—"}</span>
                    </span>
                    <span className="shrink-0 rounded-full bg-border/60 px-2 py-0.5 text-xs text-muted-foreground">
                      {r.kind === "book" ? "Book" : "50%"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
