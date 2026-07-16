"use client";

import { useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import {
  TARGET_FIELDS,
  TARGET_FIELD_LABELS,
  guessColumnMapping,
  normalizeAmount,
  normalizeDate,
  normalizeStatus,
  type TargetField,
} from "@/lib/import-utils";
import { importClientsAction, type ImportRow } from "@/app/actions";

export default function ImportPage() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Record<TargetField, number | null>>(
    Object.fromEntries(TARGET_FIELDS.map((f) => [f, null])) as Record<TargetField, number | null>
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const workbook = XLSX.read(buf, { cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
    if (data.length === 0) {
      setError("That file doesn't seem to have any rows.");
      return;
    }
    const [headerRow, ...dataRows] = data as unknown[][];
    const headerStrings = headerRow.map((h) => String(h ?? "").trim());
    setHeaders(headerStrings);
    setRows(dataRows.filter((r) => r.some((cell) => cell !== undefined && cell !== "")));
    setMapping(guessColumnMapping(headerStrings));
  }

  function mapRow(row: unknown[]): ImportRow {
    const get = (field: TargetField) => {
      const idx = mapping[field];
      return idx == null ? undefined : row[idx];
    };
    const notes = String(get("notes") ?? "").trim();
    const callNotes = String(get("callNotes") ?? "").trim();
    const combinedNotes = [notes, callNotes ? `Prior call notes: ${callNotes}` : ""]
      .filter(Boolean)
      .join("\n\n");

    return {
      name: String(get("name") ?? "").trim(),
      phone: String(get("phone") ?? "").trim(),
      opener: String(get("opener") ?? "").trim() || undefined,
      firstSaleDate: normalizeDate(get("firstSaleDate")),
      firstSaleAmount: normalizeAmount(get("firstSaleAmount")),
      status: normalizeStatus(get("status")),
      notes: combinedNotes || undefined,
    };
  }

  const previewRows = rows.slice(0, 5).map(mapRow);
  const validRowCount = rows
    .map(mapRow)
    .filter((r) => r.name && r.phone && r.firstSaleDate).length;

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const mapped = rows.map(mapRow);
      const res = await importClientsAction(mapped);
      setResult(res);
    } catch {
      setError("Import failed. Please check the file and try again.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-foreground">Import Master List</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One-time import from the old Excel Master List. Upload the file, confirm the column
          mapping, then import.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-5">
        <label className="mb-2 block text-sm text-muted-foreground" htmlFor="file">
          Excel file (.xlsx, .xls, .csv)
        </label>
        <input
          id="file"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
          className="text-sm text-foreground"
        />
        {fileName && <p className="mt-2 text-xs text-muted-foreground">Loaded: {fileName}</p>}
        {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {headers.length > 0 && (
        <>
          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">Column Mapping</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              We guessed the mapping from your column headers — adjust anything that&apos;s wrong.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {TARGET_FIELDS.map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-sm text-muted-foreground">
                    {TARGET_FIELD_LABELS[field]}
                  </label>
                  <select
                    value={mapping[field] ?? ""}
                    onChange={(e) =>
                      setMapping((prev) => ({
                        ...prev,
                        [field]: e.target.value === "" ? null : Number(e.target.value),
                      }))
                    }
                    className="w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none"
                  >
                    <option value="">— none —</option>
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h || `Column ${i + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-5">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Preview ({rows.length} rows found, {validRowCount} look importable)
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full divide-y divide-border text-sm">
                <thead className="text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-2 py-1">Name</th>
                    <th className="px-2 py-1">Phone</th>
                    <th className="px-2 py-1">Opener</th>
                    <th className="px-2 py-1">First Sale Date</th>
                    <th className="px-2 py-1">Amount</th>
                    <th className="px-2 py-1">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-foreground">
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">{r.name || "—"}</td>
                      <td className="px-2 py-1">{r.phone || "—"}</td>
                      <td className="px-2 py-1">{r.opener || "—"}</td>
                      <td className="px-2 py-1">{r.firstSaleDate || "—"}</td>
                      <td className="px-2 py-1">{r.firstSaleAmount ?? "—"}</td>
                      <td className="px-2 py-1">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              type="button"
              disabled={importing || validRowCount === 0}
              onClick={handleImport}
              className="mt-4 rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {importing ? "Importing…" : `Import ${validRowCount} clients`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Imported {result.imported} clients.{" "}
          <Link href="/" className="underline">
            Go to dashboard
          </Link>
        </div>
      )}
    </div>
  );
}
