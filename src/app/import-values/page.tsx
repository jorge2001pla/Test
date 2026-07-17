"use client";

import { useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import { normalizeAmount } from "@/lib/import-utils";
import { importClientValuesAction, type ValueImportRow, type ValueImportResult } from "@/app/actions";

const FIELDS = ["name", "phone", "value"] as const;
type Field = (typeof FIELDS)[number];

const FIELD_LABELS: Record<Field, string> = {
  name: "Client Name",
  phone: "Phone (optional, improves matching)",
  value: "Lifetime Value",
};

const GUESS_KEYWORDS: Record<Field, string[]> = {
  name: ["client name", "name"],
  phone: ["phone", "cell", "mobile"],
  value: ["lifetime", "total", "spend", "revenue", "value"],
};

function guessMapping(headers: string[]): Record<Field, number | null> {
  const lowerHeaders = headers.map((h) => h.toLowerCase().trim());
  const mapping = {} as Record<Field, number | null>;
  const used = new Set<number>();
  for (const field of FIELDS) {
    let found: number | null = null;
    for (const keyword of GUESS_KEYWORDS[field]) {
      const idx = lowerHeaders.findIndex((h, i) => h.includes(keyword) && !used.has(i));
      if (idx !== -1) {
        found = idx;
        break;
      }
    }
    mapping[field] = found;
    if (found !== null) used.add(found);
  }
  return mapping;
}

export default function ImportValuesPage() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<unknown[][]>([]);
  const [mapping, setMapping] = useState<Record<Field, number | null>>(
    Object.fromEntries(FIELDS.map((f) => [f, null])) as Record<Field, number | null>
  );
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<ValueImportResult | null>(null);
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
    setMapping(guessMapping(headerStrings));
  }

  function mapRow(row: unknown[]): ValueImportRow {
    const get = (field: Field) => {
      const idx = mapping[field];
      return idx == null ? undefined : row[idx];
    };
    return {
      name: String(get("name") ?? "").trim(),
      phone: String(get("phone") ?? "").trim() || undefined,
      value: normalizeAmount(get("value")) ?? 0,
    };
  }

  const previewRows = rows.slice(0, 5).map(mapRow);
  const validRowCount = rows.map(mapRow).filter((r) => r.name && r.value > 0).length;

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const mapped = rows.map(mapRow).filter((r) => r.name && r.value > 0);
      const res = await importClientValuesAction(mapped);
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
        <Link href="/book" className="text-sm text-muted-foreground hover:text-gold">
          ← Back to Clients
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold text-foreground">Import Client Values</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Load lifetime values from your CRM export. Matched by phone number first, then exact
          name — clients that don&apos;t match anyone in your book are skipped and listed below.
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
              {FIELDS.map((field) => (
                <div key={field}>
                  <label className="mb-1 block text-sm text-muted-foreground">{FIELD_LABELS[field]}</label>
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
                    <th className="px-2 py-1">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border text-foreground">
                  {previewRows.map((r, i) => (
                    <tr key={i}>
                      <td className="px-2 py-1">{r.name || "—"}</td>
                      <td className="px-2 py-1">{r.phone || "—"}</td>
                      <td className="px-2 py-1">{r.value || "—"}</td>
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
              {importing ? "Importing…" : `Import ${validRowCount} values`}
            </button>
          </div>
        </>
      )}

      {result && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-700 dark:text-emerald-400">
          Matched and updated {result.matched} clients.
          {result.unmatched.length > 0 && (
            <div className="mt-2 text-foreground">
              <p className="font-medium">Couldn&apos;t match {result.unmatched.length}:</p>
              <p className="mt-1 text-muted-foreground">{result.unmatched.join(", ")}</p>
            </div>
          )}
          <div className="mt-2">
            <Link href="/book" className="underline">
              Go to Clients
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
