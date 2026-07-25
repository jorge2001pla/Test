"use client";

import { useState, useTransition } from "react";
import { updateClientDetailsAction, updateBookClientDetailsAction } from "@/app/actions";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

interface FieldDef {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
}

const CLIENT_FIELDS: FieldDef[] = [
  { key: "name", label: "Client Name", required: true },
  { key: "phone", label: "Phone Number", type: "tel", required: true },
  { key: "email", label: "Email", type: "email" },
  { key: "opener", label: "Opener" },
  { key: "firstSaleDate", label: "First Sale Date", type: "date", required: true },
  { key: "firstSaleAmount", label: "First Sale Amount", type: "number" },
];

const BOOK_FIELDS: FieldDef[] = [
  { key: "firstName", label: "First Name" },
  { key: "lastName", label: "Last Name" },
  { key: "phone", label: "Phone Number", type: "tel" },
  { key: "secondaryPhone", label: "Secondary Phone", type: "tel" },
  { key: "email", label: "Email", type: "email" },
];

/** Inline "Edit Details" panel for both profile types — fixes typos and mis-entered details
 * (wrong opener, missing email, new phone) without touching dispo or call history. */
export default function EditClientDetails({
  id,
  kind,
  initial,
}: {
  id: string;
  kind: "client" | "book";
  initial: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const fields = kind === "client" ? CLIENT_FIELDS : BOOK_FIELDS;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        if (kind === "client") {
          await updateClientDetailsAction(id, {
            name: values.name ?? "",
            phone: values.phone ?? "",
            email: values.email || null,
            opener: values.opener || null,
            firstSaleDate: values.firstSaleDate ?? "",
            firstSaleAmount: values.firstSaleAmount ? Number(values.firstSaleAmount) : null,
          });
        } else {
          await updateBookClientDetailsAction(id, {
            firstName: values.firstName || null,
            lastName: values.lastName || null,
            phone: values.phone || null,
            secondaryPhone: values.secondaryPhone || null,
            email: values.email || null,
          });
        }
        setOpen(false);
      } catch {
        setError("Couldn't save — check the required fields and try again.");
      }
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValues(initial);
          setOpen(true);
        }}
        className="rounded border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-gold hover:text-gold"
      >
        Edit Details
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 w-full rounded-lg border border-border bg-background/50 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key}>
            <label className="mb-1 block text-sm text-muted-foreground" htmlFor={`edit-${f.key}`}>
              {f.label}
            </label>
            <input
              id={`edit-${f.key}`}
              type={f.type ?? "text"}
              step={f.type === "number" ? "0.01" : undefined}
              required={f.required}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className={inputClass}
            />
          </div>
        ))}
      </div>
      {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-gold px-4 py-2 text-sm font-medium text-brand-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}
