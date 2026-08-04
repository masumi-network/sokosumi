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

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reject prototype-polluting property names before any dynamic write. */
function isUnsafePropertyName(name) {
  return name === "__proto__" || name === "constructor" || name === "prototype";
}

/**
 * Nested Map tree avoids Object.prototype sinks while building catalogs.
 * Leaf values are stored directly; children are Maps.
 */
function setPathInMap(root, parts, value) {
  let current = root;
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index];
    if (part === undefined || isUnsafePropertyName(part)) {
      throw new Error(
        `[messages:parity] blocked path segment "${part}" (prototype pollution guard)`,
      );
    }
    let next = current.get(part);
    if (!(next instanceof Map)) {
      next = new Map();
      current.set(part, next);
    }
    current = next;
  }

  const leaf = parts[parts.length - 1];
  if (leaf === undefined || isUnsafePropertyName(leaf)) {
    throw new Error(
      `[messages:parity] blocked path segment "${leaf}" (prototype pollution guard)`,
    );
  }
  current.set(leaf, value);
}

function deletePathInMap(root, parts) {
  if (parts.length === 0) {
    return;
  }

  const stack = [{ map: root, key: null }];
  let current = root;

  for (const part of parts) {
    if (isUnsafePropertyName(part) || !(current instanceof Map)) {
      return;
    }
    if (!current.has(part)) {
      return;
    }
    stack.push({ map: current, key: part });
    current = current.get(part);
  }

  const leafFrame = stack[stack.length - 1];
  if (leafFrame?.key != null) {
    leafFrame.map.delete(leafFrame.key);
  }

  for (let index = stack.length - 1; index >= 1; index--) {
    const frame = stack[index];
    if (frame?.key == null) {
      continue;
    }
    const child = frame.map.get(frame.key);
    if (child instanceof Map && child.size === 0) {
      frame.map.delete(frame.key);
    }
  }
}

function objectToMap(value) {
  if (!isPlainObject(value)) {
    return value;
  }
  const map = new Map();
  for (const key of Object.keys(value)) {
    if (isUnsafePropertyName(key)) {
      throw new Error(
        `[messages:parity] blocked path segment "${key}" (prototype pollution guard)`,
      );
    }
    map.set(key, objectToMap(value[key]));
  }
  return map;
}

function mapToObject(node) {
  if (!(node instanceof Map)) {
    return node;
  }
  // Emit JSON text then parse. Avoids `obj[dynamicKey] =` sinks that CodeQL
  // flags even after prototype-key guards.
  const fields = [];
  for (const [key, child] of node) {
    if (isUnsafePropertyName(key)) {
      throw new Error(
        `[messages:parity] blocked path segment "${key}" (prototype pollution guard)`,
      );
    }
    fields.push(`${JSON.stringify(key)}:${JSON.stringify(mapToObject(child))}`);
  }
  return JSON.parse(`{${fields.join(",")}}`);
}

function collectLeafPathsFromMap(node, prefix = "", out = []) {
  if (!(node instanceof Map)) {
    out.push(prefix);
    return out;
  }

  if (node.size === 0) {
    if (prefix) {
      out.push(prefix);
    }
    return out;
  }

  for (const [key, child] of node) {
    if (isUnsafePropertyName(key)) {
      throw new Error(
        `[messages:parity] blocked path segment "${key}" (prototype pollution guard)`,
      );
    }
    const next = prefix ? `${prefix}.${key}` : key;
    collectLeafPathsFromMap(child, next, out);
  }
  return out;
}

function getAtPathInMap(root, parts) {
  let current = root;
  for (const part of parts) {
    if (isUnsafePropertyName(part) || !(current instanceof Map)) {
      return { found: false, value: undefined };
    }
    if (!current.has(part)) {
      return { found: false, value: undefined };
    }
    current = current.get(part);
  }
  return { found: true, value: current };
}

function splitPath(dottedPath) {
  return dottedPath.split(".");
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
const enMap = objectToMap(en);
if (!(enMap instanceof Map)) {
  throw new Error("[messages:parity] en.json root must be an object");
}
const enPaths = new Set(collectLeafPathsFromMap(enMap));
let failed = false;

for (const locale of LOCALES) {
  const catalog = readJson(locale);
  const catalogMap = objectToMap(catalog);
  if (!(catalogMap instanceof Map)) {
    throw new Error(`[messages:parity] ${locale}.json root must be an object`);
  }
  const localePaths = new Set(collectLeafPathsFromMap(catalogMap));
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
    const parts = splitPath(key);
    const { value } = getAtPathInMap(enMap, parts);
    setPathInMap(catalogMap, parts, value);
  }
  for (const key of extra) {
    deletePathInMap(catalogMap, splitPath(key));
  }
  writeJson(locale, mapToObject(catalogMap));
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
