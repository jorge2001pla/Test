"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";
import PhoneLink from "@/components/PhoneLink";
import ValueBadge from "@/components/ValueBadge";
import type { ClientStatus } from "@/lib/types";

export interface BookClientRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  secondaryPhone: string | null;
  status: ClientStatus;
  lifetimeValue: number;
}

export default function BookClientTable({ clients }: { clients: BookClientRow[] }) {
  const [query, setQuery] = useState("");
  const [sortByValue, setSortByValue] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? clients.filter(
          (c) =>
            (c.firstName ?? "").toLowerCase().includes(q) || (c.lastName ?? "").toLowerCase().includes(q)
        )
      : clients;
    if (!sortByValue) return base;
    return [...base].sort((a, b) => b.lifetimeValue - a.lifetimeValue);
  }, [clients, query, sortByValue]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by first or last name..."
          className="w-full max-w-sm rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setSortByValue((v) => !v)}
          className={
            sortByValue
              ? "rounded bg-gold px-3 py-2 text-sm font-medium text-brand-black"
              : "rounded border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
          }
        >
          Sort by Value
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          {clients.length === 0 ? "No clients yet." : "No clients match that search."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-background text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Email</th>
                <th className="px-4 py-2">Phone</th>
                <th className="px-4 py-2">Value</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-gold/5">
                  <td className="px-4 py-3">
                    <Link
                      href={`/book/${c.id}`}
                      className="font-medium text-foreground hover:text-gold hover:underline"
                    >
                      {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{c.email ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    <PhoneLink phone={c.phone} />
                    {c.secondaryPhone && (
                      <div className="text-xs">
                        <PhoneLink phone={c.secondaryPhone} /> (secondary)
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <ValueBadge value={c.lifetimeValue} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
