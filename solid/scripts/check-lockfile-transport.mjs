// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// #78 guard: `npm install` rewrites a `github:` dependency's resolved URL to
// `git+ssh://git@github.com/...` in the lockfile, which then breaks a keyless
// `npm ci` in CI (no SSH key). Fail the gate if any `git+ssh://` transport
// survives in package-lock.json — they must all be `git+https://github.com/...`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const lockPath = join(here, "..", "package-lock.json");

let raw;
try {
  raw = readFileSync(lockPath, "utf8");
} catch {
  console.error(`check-lockfile-transport: ${lockPath} not found`);
  process.exit(1);
}

const offenders = raw
  .split("\n")
  .map((line, i) => ({ line, n: i + 1 }))
  .filter(({ line }) => line.includes("git+ssh://"));

if (offenders.length > 0) {
  console.error("check-lockfile-transport: FOUND git+ssh:// transport in package-lock.json:");
  for (const { line, n } of offenders) {
    console.error(`  L${n}: ${line.trim()}`);
  }
  console.error(
    "Rewrite each to git+https://github.com/... (keyless npm ci) — see the #78 guard.",
  );
  process.exit(1);
}

console.log("check-lockfile-transport: OK (no git+ssh:// transport in package-lock.json)");
