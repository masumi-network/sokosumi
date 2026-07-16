#!/usr/bin/env node
/**
 * CI guard: apps/web must not import @sokosumi/database or forbidden domain enum
 * values from @sokosumi/utils. See apps/web/AGENTS.md (Core DTO boundary).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const WEB_ROOT = join(ROOT, "apps/web");

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", "coverage"]);
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

const FORBIDDEN_UTILS_NAMES = new Set([
  "TaskStatus",
  "SokosumiJobStatus",
  "JobType",
  "AgentJobStatus",
  "OnChainJobStatus",
  "MemberRole",
  "InvitationStatus",
  "BlobStatus",
  "NoticeKind",
  "NotificationKind",
  "Channel",
]);

const ALLOWLIST_FILE =
  "apps/web/src/lib/clients/__tests__/core-enums-drift.test.ts";
const ALLOWLIST_UTILS_NAME = "SokosumiJobStatus";

const UTILS_MODULE_RE = /@sokosumi\/utils(?:\/[^"'`\s]+)?/;
const UTILS_STAR_IMPORT_RE =
  /import\s+\*\s+as\s+[\w$]+\s+from\s+["'`]@sokosumi\/utils(?:\/[^"'`]*)?["'`]/g;
const UTILS_NAMED_IMPORT_RE =
  /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+["'`]@sokosumi\/utils(?:\/[^"'`]*)?["'`]/g;

/** @type {Array<{ file: string; rule: string; detail: string }>} */
const violations = [];

function isAllowlisted(fileRelPath, name) {
  return fileRelPath === ALLOWLIST_FILE && name === ALLOWLIST_UTILS_NAME;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, files);
      continue;
    }
    const ext = full.slice(full.lastIndexOf("."));
    if (SCAN_EXTENSIONS.has(ext)) {
      files.push(full);
    }
  }
  return files;
}

function parseNamedImports(specifiers) {
  return specifiers
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((spec) => {
      const withoutType = spec.replace(/^type\s+/, "").trim();
      const [name] = withoutType.split(/\s+as\s+/);
      return name.trim();
    });
}

function scanFile(relPath, content) {
  if (content.includes("@sokosumi/database")) {
    violations.push({
      file: relPath,
      rule: "database-import",
      detail: "Found forbidden substring `@sokosumi/database`",
    });
  }

  if (UTILS_STAR_IMPORT_RE.test(content)) {
    violations.push({
      file: relPath,
      rule: "utils-namespace-import",
      detail: "Namespace import from @sokosumi/utils (or subpath) is forbidden",
    });
  }
  UTILS_STAR_IMPORT_RE.lastIndex = 0;

  let match = UTILS_NAMED_IMPORT_RE.exec(content);
  while (match !== null) {
    const moduleMatch = match[0].match(UTILS_MODULE_RE);
    const moduleName = moduleMatch?.[0] ?? "@sokosumi/utils";
    for (const name of parseNamedImports(match[1])) {
      if (FORBIDDEN_UTILS_NAMES.has(name) && !isAllowlisted(relPath, name)) {
        violations.push({
          file: relPath,
          rule: "utils-forbidden-enum",
          detail: `Forbidden import \`${name}\` from ${moduleName}`,
        });
      }
    }
    match = UTILS_NAMED_IMPORT_RE.exec(content);
  }
}

const files = walk(WEB_ROOT);
files.push(join(WEB_ROOT, "package.json"));

for (const file of files) {
  const relPath = relative(ROOT, file).replaceAll("\\", "/");
  scanFile(relPath, readFileSync(file, "utf8"));
}

if (violations.length > 0) {
  console.error("Web DTO boundary violations:\n");
  for (const violation of violations) {
    console.error(`  ${violation.file}`);
    console.error(`    [${violation.rule}] ${violation.detail}\n`);
  }
  console.error(
    `${violations.length} violation(s). See apps/web/AGENTS.md (Core DTO boundary).`,
  );
  process.exit(1);
}

console.log("Web DTO boundary check passed.");
process.exit(0);
