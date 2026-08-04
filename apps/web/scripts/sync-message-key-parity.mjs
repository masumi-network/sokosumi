#!/usr/bin/env node
/**
 * One-shot wrapper: sync de/es key paths to match en.json.
 * Prefer `node ./scripts/check-message-key-parity.mjs --write`.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const result = spawnSync(
  process.execPath,
  [path.join(__dirname, "check-message-key-parity.mjs"), "--write"],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
