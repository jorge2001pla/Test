// Tests must NEVER touch the production Turso database. Force a throwaway local file DB.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prc-test-"));
const file = path.join(dir, "test.db").split(path.sep).join("/");
process.env.TURSO_DATABASE_URL = `file:${file}`;
delete process.env.TURSO_AUTH_TOKEN;
if (!process.env.TURSO_DATABASE_URL.startsWith("file:")) {
  throw new Error("Refusing to run tests against a non-local database");
}
