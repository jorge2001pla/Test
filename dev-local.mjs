// Local-only dev server against a throwaway SQLite file — never touches the production Turso DB.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const env = {
  ...process.env,
  TURSO_DATABASE_URL: "file:" + path.join(dir, "data", "local-test.db").split(path.sep).join("/"),
  AUTH_USERNAME: "test",
  AUTH_PASSWORD: "test",
  SESSION_SECRET: "local-test-secret-local-test-secret-1234",
};
delete env.TURSO_AUTH_TOKEN;
const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
spawn(process.execPath, [next, "dev", "--port", "3010"], { stdio: "inherit", env, cwd: dir });
