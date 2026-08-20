#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function mustExist(rel) {
  if (!existsSync(join(root, rel))) {
    throw new Error(`missing required file: ${rel}`);
  }
}

function mustNotExist(rel) {
  if (existsSync(join(root, rel))) {
    throw new Error(`obsolete file still present: ${rel}`);
  }
}

function mustInclude(rel, needle, label = needle) {
  const body = read(rel);
  if (!body.includes(needle)) {
    throw new Error(`${rel} missing required fact: ${label}`);
  }
}

function mustNotInclude(rel, needle, label = needle) {
  const body = read(rel);
  if (body.includes(needle)) {
    throw new Error(`${rel} still contains obsolete fact: ${label}`);
  }
}

const obsoleteRules = [
  ".cursor/rules/lint.mdc",
  ".cursor/rules/caveman.mdc",
  "apps/web/.cursor/rules/analysis-process.mdc",
  "apps/web/.cursor/rules/code-style.mdc",
  "apps/web/.cursor/rules/interface.mdc",
  "apps/web/.cursor/rules/key-convention.mdc",
  "apps/web/.cursor/rules/lint.mdc",
  "apps/web/.cursor/rules/naming-convention.mdc",
  "apps/web/.cursor/rules/optimization.mdc",
  "apps/web/.cursor/rules/typescript.mdc",
  "apps/core/.cursor/rules/responses.mdc",
];

for (const rel of obsoleteRules) mustNotExist(rel);

const keepRules = [
  ".cursor/rules/principles.mdc",
  ".cursor/rules/maintainability.mdc",
  ".cursor/rules/pinned-dependencies.mdc",
  ".cursor/rules/neverthrow.mdc",
  ".cursor/rules/pstack-models.mdc",
  ".cursor/rules/shared-packages.mdc",
  ".cursor/rules/avoid-re-exports.mdc",
  ".cursor/rules/utils-vs-database.mdc",
  "apps/web/.cursor/rules/effects.mdc",
  "apps/web/.cursor/rules/i18n-formatting.mdc",
  "apps/web/.cursor/rules/translations.mdc",
  "apps/core/.cursor/rules/credits-api.mdc",
  "apps/core/.cursor/rules/data-access.mdc",
];

for (const rel of keepRules) mustExist(rel);

mustInclude("AGENTS.md", "biome");
mustInclude("AGENTS.md", "never touches Prisma");
mustInclude("AGENTS.md", "@sokosumi/net");
mustInclude("AGENTS.md", "Respond terse like smart caveman");
mustInclude("AGENTS.md", "pnpm env:bootstrap");
mustInclude("AGENTS.md", "pnpm portless:dev");
mustInclude("AGENTS.md", "pnpm portless:web");
mustInclude("AGENTS.md", "pnpm portless:core");
mustInclude("AGENTS.md", "pnpm portless:url web");
mustNotInclude("AGENTS.md", "simple-import-sort");
mustNotInclude("AGENTS.md", "packages/services");
mustNotInclude("AGENTS.md", "lint.mdc");

mustInclude("apps/web/AGENTS.md", "getEnvPublicConfig");
mustInclude("apps/web/AGENTS.md", "Internationalization (next-intl)");
mustNotInclude("apps/web/AGENTS.md", "getEnvConfig()");
mustNotInclude("apps/web/AGENTS.md", "i18next)");

mustInclude("apps/core/AGENTS.md", 'from "@sokosumi/utils"');
mustInclude("apps/core/AGENTS.md", "ok(c,");
mustNotInclude("apps/core/AGENTS.md", "@/helpers/credits");
mustNotInclude("apps/core/AGENTS.md", "responses.mdc");

mustInclude("apps/core/.cursor/rules/credits-api.mdc", "@sokosumi/utils");
mustNotInclude(
  "apps/core/.cursor/rules/credits-api.mdc",
  "@sokosumi/database/helpers",
);

mustInclude(
  "packages/database/AGENTS.md",
  "Web must not import `@sokosumi/database`",
);
mustInclude("CLAUDE.md", "@AGENTS.md");
mustInclude("CLAUDE.md", "Validate PR Title");

mustInclude(".cursor/rules/neverthrow.mdc", 'from "neverthrow"');
mustNotInclude(".cursor/rules/neverthrow.mdc", "combine(results)");

console.log("verify-agent-guidance: ok");
