/** Who "I" am in this command center — the owner. An opener matching this pattern means the
 * owner personally opened the account (so the opening sale is the owner's own sale). Env-driven
 * so coworker copies can set their own name; the default covers the "Jorge"/"George" spellings
 * that appear in the data. */
const OWNER_OPENER = new RegExp(
  `\\b(${(process.env.OWNER_OPENER ?? "jorge|george").toLowerCase()})\\b`,
  "i"
);

export function isOwnerOpener(opener: unknown): boolean {
  return typeof opener === "string" && OWNER_OPENER.test(opener);
}
