"use client";

import { useState } from "react";
import { CLIENT_STATUSES, STATUS_LABELS, type ClientStatus } from "@/lib/types";
import { TIME_OPTIONS } from "@/lib/time-options";

const inputClass =
  "rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

export default function CallbackScheduleFields({
  defaultStatus,
  defaultDate,
  defaultTime,
}: {
  defaultStatus: ClientStatus;
  defaultDate?: string;
  defaultTime?: string;
}) {
  const [status, setStatus] = useState<ClientStatus>(defaultStatus);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-1 block text-sm text-muted-foreground" htmlFor="resultingStatus">
          Resulting Status
        </label>
        <select
          id="resultingStatus"
          name="resultingStatus"
          value={status}
          onChange={(e) => setStatus(e.target.value as ClientStatus)}
          className={inputClass}
        >
          {CLIENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>

      {status === "CALLBACK" && (
        <>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="callbackDate">
              Callback Date
            </label>
            <input
              id="callbackDate"
              name="callbackDate"
              type="date"
              defaultValue={defaultDate ?? todayStr}
              className={inputClass}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor="callbackTime">
              Callback Time
            </label>
            <select
              id="callbackTime"
              name="callbackTime"
              defaultValue={defaultTime ?? ""}
              className={inputClass}
            >
              <option value="">— pick a time —</option>
              {TIME_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </div>
  );
}
