#!/usr/bin/env node
/**
 * Assert en/de/es message catalogs share the same leaf key paths.
 *
 * Usage:
 *   node ./scripts/check-message-key-parity.mjs
 *   node ./scripts/check-message-key-parity.mjs --write
 *
 * `--write` copies missing English values into de/es and removes stray
 * non-English-only keys so catalogs match `en.json`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, "../messages");
const LOCALES = ["de", "es"];
const write = process.argv.includes("--write");

const BLOCKED_PATH_SEGMENTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertSafePathSegment(segment) {
  if (BLOCKED_PATH_SEGMENTS.has(segment)) {
    throw new Error(
      `[messages:parity] blocked path segment "${segment}" (prototype pollution guard)`,
    );
  }
}

function splitSafePath(dottedPath) {
  const parts = dottedPath.split(".");
  for (const part of parts) {
    assertSafePathSegment(part);
  }
  return parts;
}

function collectLeafPaths(value, prefix = "", out = []) {
  if (!isPlainObject(value)) {
    out.push(prefix);
    return out;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    if (prefix) {
      out.push(prefix);
    }
    return out;
  }

  for (const key of keys) {
    assertSafePathSegment(key);
    const next = prefix ? `${prefix}.${key}` : key;
    collectLeafPaths(value[key], next, out);
  }
  return out;
}

function getAtPath(root, dottedPath) {
  const parts = splitSafePath(dottedPath);
  let current = root;
  for (const part of parts) {
    if (!isPlainObject(current) || !(part in current)) {
      return { found: false, value: undefined };
    }
    current = current[part];
  }
  return { found: true, value: current };
}

function setAtPath(root, dottedPath, value) {
  const parts = splitSafePath(dottedPath);
  let current = root;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    if (!isPlainObject(current[part])) {
      current[part] = Object.create(null);
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

function deleteAtPath(root, dottedPath) {
  const parts = splitSafePath(dottedPath);
  const stack = [{ parent: null, key: null, node: root }];

  let current = root;
  for (const part of parts) {
    if (!isPlainObject(current) || !(part in current)) {
      return;
    }
    stack.push({ parent: current, key: part, node: current[part] });
    current = current[part];
  }

  const leaf = stack[stack.length - 1];
  if (leaf?.parent && leaf.key != null) {
    delete leaf.parent[leaf.key];
  }

  for (let index = stack.length - 2; index >= 1; index--) {
    const frame = stack[index];
    if (
      frame?.parent &&
      frame.key != null &&
      isPlainObject(frame.node) &&
      Object.keys(frame.node).length === 0
    ) {
      delete frame.parent[frame.key];
    }
  }
}

function readJson(locale) {
  const filePath = path.join(messagesDir, `${locale}.json`);
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(locale, data) {
  const filePath = path.join(messagesDir, `${locale}.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const en = readJson("en");
const enPaths = new Set(collectLeafPaths(en));
let failed = false;

for (const locale of LOCALES) {
  const catalog = readJson(locale);
  const localePaths = new Set(collectLeafPaths(catalog));
  const missing = [...enPaths].filter((key) => !localePaths.has(key));
  const extra = [...localePaths].filter((key) => !enPaths.has(key));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`[messages:parity] ${locale}: ok`);
    continue;
  }

  if (!write) {
    failed = true;
    console.error(
      `[messages:parity] ${locale}: missing ${missing.length}, extra ${extra.length}`,
    );
    if (missing.length > 0) {
      console.error(`  missing (sample): ${missing.slice(0, 10).join(", ")}`);
    }
    if (extra.length > 0) {
      console.error(`  extra: ${extra.join(", ")}`);
    }
    continue;
  }

  for (const key of missing) {
    const { value } = getAtPath(en, key);
    setAtPath(catalog, key, value);
  }
  for (const key of extra) {
    deleteAtPath(catalog, key);
  }
  writeJson(locale, catalog);
  console.log(
    `[messages:parity] ${locale}: wrote +${missing.length} / -${extra.length}`,
  );
}

if (failed) {
  console.error(
    "[messages:parity] failing. Run `pnpm --filter web messages:parity:write` to sync.",
  );
  process.exit(1);
}
