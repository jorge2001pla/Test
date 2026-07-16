"use client";

import { useEffect, useState } from "react";

interface MetalPrice {
  price: number;
  updatedAt: string;
  source: "kitco" | "gold-api";
}

interface SpotPrices {
  gold: MetalPrice | null;
  silver: MetalPrice | null;
}

const POLL_MS = 60_000;

function formatPrice(price: number): string {
  return price.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function SpotPriceTicker() {
  const [prices, setPrices] = useState<SpotPrices | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setRefreshing(true);
      try {
        const res = await fetch("/api/spot-prices", { cache: "no-store" });
        const data: SpotPrices = await res.json();
        if (!cancelled) {
          setPrices(data);
          setFailed(!data.gold && !data.silver);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }

    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshNonce]);

  if (failed || !prices) {
    return null;
  }

  return (
    <div className="flex items-center gap-4 font-sans text-base font-medium text-header-foreground">
      {prices.gold && (
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-gold-bright">Au</span>
          <span className="tabular-nums">{formatPrice(prices.gold.price)}/oz</span>
        </span>
      )}
      {prices.silver && (
        <span className="flex items-center gap-1.5">
          <span className="font-semibold text-gold-bright">Ag</span>
          <span className="tabular-nums">{formatPrice(prices.silver.price)}/oz</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => setRefreshNonce((n) => n + 1)}
        disabled={refreshing}
        aria-label="Refresh spot prices"
        title="Refresh spot prices"
        className="flex h-6 w-6 items-center justify-center rounded-full text-header-foreground/70 transition-colors hover:text-gold-bright disabled:opacity-50"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
        >
          <path d="M21 12a9 9 0 1 1-2.64-6.36" />
          <path d="M21 3v6h-6" />
        </svg>
      </button>
    </div>
  );
}
