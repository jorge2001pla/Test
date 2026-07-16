"use client";

import { useState } from "react";
import Link from "next/link";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export interface CalendarCallback {
  id: string;
  name: string;
  time: string;
  href: string;
}

function AgendaList({
  title,
  emptyText,
  entries,
}: {
  title: string;
  emptyText: string;
  entries: { label: string; callbacks: CalendarCallback[] }[];
}) {
  const hasAny = entries.some((e) => e.callbacks.length > 0);
  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-background p-5">
      <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
      {!hasAny ? (
        <p className="mt-3 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-4 overflow-y-auto">
          {entries
            .filter((e) => e.callbacks.length > 0)
            .map((entry) => (
              <li key={entry.label}>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {entry.label}
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {entry.callbacks.map((cb) => (
                    <li key={cb.id} className="flex items-center justify-between text-sm">
                      <Link
                        href={cb.href}
                        className="text-foreground hover:text-gold hover:underline"
                      >
                        {cb.name}
                      </Link>
                      <span className="text-muted-foreground">{cb.time}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export default function MonthCalendar({
  year,
  month,
  todayDate,
  callbacksByDay,
  prevHref,
  nextHref,
}: {
  year: number;
  month: number;
  todayDate: string;
  callbacksByDay: Record<string, CalendarCallback[]>;
  prevHref: string;
  nextHref: string;
}) {
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const monthName = new Date(year, month, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function dateKey(day: number): string {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const agendaEntries = selectedDay
    ? [
        {
          label: new Date(`${selectedDay}T00:00`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          }),
          callbacks: callbacksByDay[selectedDay] ?? [],
        },
      ]
    : Object.keys(callbacksByDay)
        .sort()
        .map((key) => ({
          label: new Date(`${key}T00:00`).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
          }),
          callbacks: callbacksByDay[key],
        }));

  return (
    <div className="grid grid-cols-1 gap-6 rounded-lg border border-border bg-card p-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div>
        <div className="mx-auto flex max-w-md items-center justify-between">
          <Link
            href={prevHref}
            aria-label="Previous month"
            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-gold"
          >
            ‹
          </Link>
          <h2 className="font-display text-2xl font-semibold text-foreground">{monthName}</h2>
          <Link
            href={nextHref}
            aria-label="Next month"
            className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground transition-colors hover:text-gold"
          >
            ›
          </Link>
        </div>

        <div className="mx-auto mt-5 grid max-w-md grid-cols-7 gap-2 text-center text-base">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-1.5 font-medium text-muted-foreground">
              {d}
            </div>
          ))}
          {cells.map((day, i) => {
            if (!day) return <div key={i} />;
            const key = dateKey(day);
            const isToday = key === todayDate;
            const dayCallbacks = callbacksByDay[key] ?? [];
            const hasCallbacks = dayCallbacks.length > 0;
            const isSelected = selectedDay === key;

            return (
              <button
                type="button"
                key={i}
                onClick={() => setSelectedDay(isSelected ? null : hasCallbacks ? key : null)}
                className={`relative flex aspect-square flex-col items-center justify-center rounded-full text-lg ${
                  isToday
                    ? "bg-gold font-semibold text-brand-black"
                    : isSelected
                      ? "bg-gold/20 text-foreground"
                      : "text-foreground"
                } ${hasCallbacks ? "cursor-pointer hover:bg-gold/10" : "cursor-default"}`}
              >
                {day}
                {hasCallbacks && (
                  <span
                    className={`absolute bottom-1.5 h-1.5 w-1.5 rounded-full ${
                      isToday ? "bg-brand-black" : "bg-gold"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <AgendaList
        title={selectedDay ? "Selected Day" : "This Month's Callbacks"}
        emptyText={selectedDay ? "No callbacks scheduled." : "No callbacks scheduled this month."}
        entries={agendaEntries}
      />
    </div>
  );
}
