"use client";

import { useState } from "react";

const inputClass =
  "w-full rounded border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-gold focus:outline-none";

export default function NameFieldsWithDuplicateCheck({
  existingNames,
}: {
  /** Lowercased "first last" full names already in the book. */
  existingNames: string[];
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const full = `${firstName} ${lastName}`.trim().toLowerCase();
  const isDuplicate = full.length > 0 && existingNames.includes(full);

  return (
    <div className="space-y-2">
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="firstName">
            First Name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="flex-1">
          <label className="mb-1 block text-sm text-muted-foreground" htmlFor="lastName">
            Last Name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      {isDuplicate && (
        <p className="text-sm text-gold">
          {`Heads up — ${firstName} ${lastName} looks like it's already in your book. You can still add them if this is a different person.`}
        </p>
      )}
    </div>
  );
}
