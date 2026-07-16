"use client";

import { useEffect, useState } from "react";
import { SALES_QUOTES } from "@/lib/quotes";

const ROTATE_MS = 8_000;

function todaysQuoteIndex(): number {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000
  );
  return dayOfYear % SALES_QUOTES.length;
}

export default function SalesQuoteBanner() {
  const [index, setIndex] = useState(todaysQuoteIndex);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setVisible(false);
      const timeout = setTimeout(() => {
        setIndex((i) => (i + 1) % SALES_QUOTES.length);
        setVisible(true);
      }, 300);
      return () => clearTimeout(timeout);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="border-b border-white/10 bg-brand-black">
      <p
        className={`mx-auto max-w-5xl px-4 py-2 text-center font-display text-lg italic tracking-wide text-gold-bright transition-opacity duration-300 ${
          visible ? "opacity-100" : "opacity-0"
        }`}
      >
        &ldquo;{SALES_QUOTES[index]}&rdquo;
      </p>
    </div>
  );
}
