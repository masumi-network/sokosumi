import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { describe, test } from "node:test";
import {
  ALIAS_PLUGIN_REL_FROM_APP,
  COMMON_BASE_INCLUDES,
  DIRECT_PLUGIN_REL_FROM_APP,
  EFFECT_APPS,
  formatEffectBaseline,
  GENERATED_BIOME_EXTEND_PATH,
  GENERATED_BIOME_FILENAME,
  ROOT,
  ROOT_BIOME_EXTEND_PATH,
  sortBaselineKeys,
  syncAppEffectBaseline,
} from "../sync-effect-baseline.mjs";

const DIRECT_PLUGIN_PATH = join(ROOT, "biome-plugins/no-direct-effects.grit");
const ALIAS_PLUGIN_PATH = join(ROOT, "biome-plugins/no-effect-aliases.grit");

const EXPECTED_MESSAGE =
  "Effects live only in src/hooks/effects/. Compute during render, use an event handler, reset with key, or call a named hook from that folder. See docs/agents/web-ui.md#effects.";

const APPS = EFFECT_APPS.map((app) => ({
  ...app,
  dir: join(ROOT, app.relDir),
}));

// Captures the category list of any Biome suppression directive up to `:`,
// `<`, or end-of-line so multi-category headers (e.g.
// `biome-ignore lint/correctness/noUnusedVariables lint/plugin/no-direct-effects(x): ...`)
// are inspected category by category after stripping any `(...)` value suffix.
const BIOME_SUPPRESSION_HEADER_RE =
  /\bbiome-ignore(?:-(?:all|start))?[ \t]+([^:\n<]+?)(?=:|<|$)/g;

const FORBIDDEN_SUPPRESSION_CATEGORY_RE =
  /^(?:lint|lint\/plugin|lint\/plugin\/no-direct-effects|lint\/plugin\/no-effect-aliases|plugin|plugin\/no-direct-effects|plugin\/no-effect-aliases|no-direct-effects|no-effect-aliases)$/;

const SCRIPT_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

function resolveBiomeBin() {
  const local = join(ROOT, "node_modules/.bin/biome");
  return existsSync(local) ? local : "biome";
}

function toPosixPath(p) {
  return p.split(sep).join("/");
}

function isExemptPath(relPath, { exemptUi }) {
  if (!relPath.startsWith("src/")) return true;
  if (relPath.startsWith("src/hooks/effects/")) return true;
  if (exemptUi && relPath.startsWith("src/components/ui/")) return true;
  if (relPath.startsWith("src/test/")) return true;
  if (relPath.startsWith("src/test-fixtures/")) return true;
  if (/(?:^|\/)__tests__\//.test(relPath)) return true;
  if (/(?:^|\/)fixtures\//.test(relPath)) return true;
  const base = relPath.slice(relPath.lastIndexOf("/") + 1);
  if (/\.(?:test|spec)\.[^/]+$/.test(base)) return true;
  if (/(?:-|\.)fixtures?\.[^/]+$/.test(base)) return true;
  if (/^fixtures\.[^/]+$/.test(base)) return true;
  if (/^fixture-[^/]+\.[^/]+$/.test(base)) return true;
  return false;
}

function walkFiles(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(full));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extracts JS/TS line (`// ...`) and block (`/* ... *\/`) comments while
 * skipping string literals and template literals so directive text inside
 * string literals is never flagged. Single/double quotes reset at newlines so
 * bare apostrophes in JSX text (`<div>Don't</div>`) cannot hide later comments.
 */
function extractComments(source) {
  const comments = [];
  let i = 0;
  let line = 1;
  let state = "code";
  let quote = "";
  const templateBraceDepth = [];

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === "code") {
      if (ch === "\n") {
        line++;
        i++;
      } else if (ch === "/" && next === "/") {
        const startLine = line;
        i += 2;
        const start = i;
        while (i < source.length && source[i] !== "\n") i++;
        comments.push({ line: startLine, text: source.slice(start, i) });
      } else if (ch === "/" && next === "*") {
        const startLine = line;
        i += 2;
        const start = i;
        while (
          i < source.length &&
          !(source[i] === "*" && source[i + 1] === "/")
        ) {
          if (source[i] === "\n") line++;
          i++;
        }
        comments.push({ line: startLine, text: source.slice(start, i) });
        if (i < source.length) i += 2;
      } else if (ch === "'" || ch === '"') {
        state = "string";
        quote = ch;
        i++;
      } else if (ch === "`") {
        state = "template";
        i++;
      } else if (ch === "{" && templateBraceDepth.length > 0) {
        templateBraceDepth[templateBraceDepth.length - 1]++;
        i++;
      } else if (ch === "}" && templateBraceDepth.length > 0) {
        templateBraceDepth[templateBraceDepth.length - 1]--;
        if (templateBraceDepth[templateBraceDepth.length - 1] === 0) {
          templateBraceDepth.pop();
          state = "template";
        }
        i++;
      } else {
        i++;
      }
    } else if (state === "string") {
      if (ch === "\\" && next !== undefined) {
        if (next === "\n") line++;
        i += 2;
      } else if (ch === "\n") {
        // JS/TS single- and double-quoted strings cannot span an unescaped
        // newline; resetting prevents a JSX text apostrophe from leaking.
        line++;
        state = "code";
        i++;
      } else if (ch === quote) {
        state = "code";
        i++;
      } else {
        i++;
      }
    } else {
      // template literal
      if (ch === "\\" && next !== undefined) {
        if (next === "\n") line++;
        i += 2;
      } else if (ch === "`") {
        state = "code";
        i++;
      } else if (ch === "$" && next === "{") {
        templateBraceDepth.push(1);
        state = "code";
        i += 2;
      } else {
        if (ch === "\n") line++;
        i++;
      }
    }
  }

  return comments;
}

function runBiomeJson(args, cwd) {
  const result = spawnSync(resolveBiomeBin(), args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  assert.ok(
    result.stdout.trim().startsWith("{"),
    `Biome did not emit JSON (status ${result.status}):\n${result.stderr}\n${result.stdout}`,
  );
  return JSON.parse(result.stdout);
}

/**
 * Runs a single Grit plugin over `app.dir/src` with no baseline exclusions and
 * returns a map of checked product file -> diagnostic locations/counts.
 */
function scanAppWithPlugin(app, pluginPath, pluginFileName) {
  const tempConfigDir = mkdtempSync(join(tmpdir(), "effect-scan-"));
  try {
    writeFileSync(
      join(tempConfigDir, pluginFileName),
      readFileSync(pluginPath, "utf8"),
    );
    writeFileSync(
      join(tempConfigDir, "biome.json"),
      JSON.stringify({
        linter: { enabled: true, rules: { preset: "none" } },
        plugins: [`./${pluginFileName}`],
      }),
    );

    const report = runBiomeJson(
      [
        "lint",
        `--config-path=${tempConfigDir}`,
        "--reporter=json",
        "--max-diagnostics=none",
        join(app.dir, "src"),
      ],
      ROOT,
    );

    const counts = new Map();
    for (const diagnostic of report.diagnostics) {
      if (diagnostic.category !== "plugin") continue;
      if (diagnostic.message !== EXPECTED_MESSAGE) continue;
      const diagPath = diagnostic.location?.path;
      if (!diagPath) continue;
      const absPath = diagPath.startsWith("/")
        ? diagPath
        : join(ROOT, diagPath);
      const relPath = toPosixPath(relative(app.dir, absPath));
      if (isExemptPath(relPath, app)) continue;
      counts.set(relPath, (counts.get(relPath) ?? 0) + 1);
    }
    return counts;
  } finally {
    rmSync(tempConfigDir, { recursive: true, force: true });
  }
}

function countActualEffects(app) {
  return scanAppWithPlugin(app, DIRECT_PLUGIN_PATH, "no-direct-effects.grit");
}

function findAliasViolations(app) {
  const hits = scanAppWithPlugin(
    app,
    ALIAS_PLUGIN_PATH,
    "no-effect-aliases.grit",
  );
  return [...hits.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([file, count]) =>
        `${file}: ${count} forbidden effect alias/indirection match(es). Aliases, namespace/computed members, destructuring, and renamed re-exports are never grandfathered.`,
    );
}

function findEffectSuppressionsInFiles(filesByRelPath) {
  const findings = [];
  for (const [relPath, text] of filesByRelPath) {
    for (const comment of extractComments(text)) {
      comment.text.split("\n").forEach((commentLine, offset) => {
        for (const match of commentLine.matchAll(BIOME_SUPPRESSION_HEADER_RE)) {
          // Strip optional Biome category value suffixes like `(anything)`
          // before splitting so values containing spaces still normalize cleanly.
          const withoutValues = match[1].replace(/\([^)]*\)/g, "");
          const categories = withoutValues.trim().split(/[ \t]+/);
          for (const rawCategory of categories) {
            const category = rawCategory.replace(/\(.*$/, "");
            if (FORBIDDEN_SUPPRESSION_CATEGORY_RE.test(category)) {
              findings.push(
                `${relPath}:${comment.line + offset} ${match[0].trim()}`,
              );
              break;
            }
          }
        }
      });
    }
  }
  return findings;
}

function findEffectSuppressions(app) {
  const files = new Map();
  for (const absPath of walkFiles(join(app.dir, "src"))) {
    if (!SCRIPT_FILE_RE.test(absPath)) continue;
    const relPath = toPosixPath(relative(app.dir, absPath));
    if (isExemptPath(relPath, app)) continue;
    files.set(relPath, readFileSync(absPath, "utf8"));
  }
  return findEffectSuppressionsInFiles(files);
}

function findBaselineFormatViolations(rawBaselineText, baseline) {
  const errors = [];
  const keys = Object.keys(baseline);
  const sortedKeys = sortBaselineKeys(keys);
  if (JSON.stringify(keys) !== JSON.stringify(sortedKeys)) {
    errors.push(
      "effect-baseline.json keys must be sorted in ascending code-point order so parallel migration PRs merge cleanly.",
    );
  }
  const canonical = formatEffectBaseline(baseline);
  if (rawBaselineText !== canonical) {
    errors.push(
      "effect-baseline.json must use canonical conflict-friendly JSON formatting (sorted keys, one entry per line, 2-space indent, trailing newline).",
    );
  }
  return errors;
}

function findBaselineViolations({
  actualCounts,
  baseline,
  rawBaselineText,
  biomeExtends = [ROOT_BIOME_EXTEND_PATH, GENERATED_BIOME_EXTEND_PATH],
  hasDirectPluginInBiome = false,
  aliasOverrideIncludes,
  baseIncludes,
}) {
  const errors = [];

  if (rawBaselineText !== undefined) {
    errors.push(...findBaselineFormatViolations(rawBaselineText, baseline));
  }

  for (const [file, limit] of Object.entries(baseline)) {
    if (!Number.isInteger(limit) || limit <= 0) {
      errors.push(
        `${file}: baseline count must be a positive integer (got ${JSON.stringify(limit)}); drop zero-count entries.`,
      );
      continue;
    }
    const actual = actualCounts.get(file) ?? 0;
    if (actual === 0) {
      errors.push(
        `${file}: has 0 direct effects; remove it from effect-baseline.json.`,
      );
    } else if (actual > limit) {
      errors.push(
        `${file}: direct effects grew from ${limit} to ${actual}. Move new effects into src/hooks/effects/.`,
      );
    } else if (actual < limit) {
      errors.push(
        `${file}: direct effects dropped from ${limit} to ${actual}; lower its count in effect-baseline.json.`,
      );
    }
  }

  for (const [file, actual] of actualCounts) {
    if (actual > 0 && !(file in baseline)) {
      errors.push(
        `${file}: ${actual} direct effect(s) in a non-baselined file. Move effects into src/hooks/effects/.`,
      );
    }
  }

  if (
    !Array.isArray(biomeExtends) ||
    biomeExtends.indexOf(ROOT_BIOME_EXTEND_PATH) === -1 ||
    biomeExtends.indexOf(GENERATED_BIOME_EXTEND_PATH) === -1 ||
    biomeExtends.indexOf(ROOT_BIOME_EXTEND_PATH) >
      biomeExtends.indexOf(GENERATED_BIOME_EXTEND_PATH)
  ) {
    errors.push(
      `biome.json must extend ["${ROOT_BIOME_EXTEND_PATH}", "${GENERATED_BIOME_EXTEND_PATH}"] so effect exemptions derive from effect-baseline.json.`,
    );
  }

  if (hasDirectPluginInBiome) {
    errors.push(
      `biome.json must not inline ${DIRECT_PLUGIN_REL_FROM_APP}; keep effect-baseline.json as the single source of truth via ${GENERATED_BIOME_FILENAME}.`,
    );
  }

  if (
    aliasOverrideIncludes !== undefined &&
    JSON.stringify(aliasOverrideIncludes) !== JSON.stringify(baseIncludes)
  ) {
    errors.push(
      "biome.json effect-alias override includes must match baseIncludes with no baselined exemptions.",
    );
  }

  return errors;
}

function findBaselineGrowth(currentBaseline, baseBaseline) {
  const errors = [];
  for (const [file, count] of Object.entries(currentBaseline)) {
    const previous = baseBaseline[file] ?? 0;
    if (count > previous) {
      errors.push(
        `${file}: baseline grew from ${previous} to ${count}. The baseline may only shrink.`,
      );
    }
  }
  return errors;
}

/**
 * Reads `apps/<appName>/effect-baseline.json` from `baseRef`.
 * Returns `null` ONLY when `baseRef` is a valid commit that predates the file;
 * invalid refs, git errors, and malformed JSON all throw.
 */
function readBaseBaseline(
  baseRef,
  appName,
  { cwd = ROOT, env = process.env } = {},
) {
  const verify = spawnSync(
    "git",
    ["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`],
    { cwd, env, encoding: "utf8" },
  );
  if (verify.error) throw verify.error;
  if (verify.status !== 0) {
    throw new Error(
      `Invalid EFFECT_BASELINE_BASE_REF "${baseRef}": ${verify.stderr.trim() || "commit not found"}`,
    );
  }

  const relPath = `apps/${appName}/effect-baseline.json`;
  const lsTree = spawnSync(
    "git",
    ["ls-tree", "--name-only", baseRef, "--", relPath],
    { cwd, env, encoding: "utf8" },
  );
  if (lsTree.error) throw lsTree.error;
  if (lsTree.status !== 0) {
    throw new Error(
      `Failed to inspect ${relPath} at ${baseRef}: ${lsTree.stderr.trim()}`,
    );
  }
  if (!lsTree.stdout.trim()) {
    return null;
  }

  const raw = execFileSync("git", ["show", `${baseRef}:${relPath}`], {
    cwd,
    env,
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

function checkAppDir(app) {
  const baselinePath = join(app.dir, "effect-baseline.json");
  const biomePath = join(app.dir, "biome.json");
  assert.ok(existsSync(baselinePath), `missing ${baselinePath}`);

  const rawBaselineText = readFileSync(baselinePath, "utf8");
  const baseline = JSON.parse(rawBaselineText);
  const biomeConfig = JSON.parse(readFileSync(biomePath, "utf8"));
  const directOverride = (biomeConfig.overrides ?? []).find(
    (override) =>
      Array.isArray(override.plugins) &&
      override.plugins.includes(DIRECT_PLUGIN_REL_FROM_APP),
  );

  const aliasOverride = (biomeConfig.overrides ?? []).find(
    (override) =>
      Array.isArray(override.plugins) &&
      override.plugins.includes(ALIAS_PLUGIN_REL_FROM_APP),
  );
  assert.ok(
    aliasOverride,
    `apps/${app.name}/biome.json must attach ${ALIAS_PLUGIN_REL_FROM_APP} via an override`,
  );

  const suppressions = findEffectSuppressions(app);
  const aliases = findAliasViolations(app);
  const actualCounts = countActualEffects(app);
  const violations = findBaselineViolations({
    actualCounts,
    baseline,
    rawBaselineText,
    biomeExtends: biomeConfig.extends,
    hasDirectPluginInBiome: Boolean(directOverride),
    aliasOverrideIncludes: aliasOverride.includes ?? [],
    baseIncludes: app.baseIncludes,
  });

  return { baseline, suppressions, aliases, violations };
}

function writeTempPlugins(fixture) {
  mkdirSync(join(fixture, "biome-plugins"), { recursive: true });
  writeFileSync(
    join(fixture, "biome-plugins/no-direct-effects.grit"),
    readFileSync(DIRECT_PLUGIN_PATH, "utf8"),
  );
  writeFileSync(
    join(fixture, "biome-plugins/no-effect-aliases.grit"),
    readFileSync(ALIAS_PLUGIN_PATH, "utf8"),
  );
  writeFileSync(
    join(fixture, "biome.jsonc"),
    JSON.stringify({
      files: {
        includes: ["**", `!**/${GENERATED_BIOME_FILENAME}`],
      },
      linter: { enabled: true, rules: { preset: "none" } },
    }),
  );
}

describe("no-direct-effects Grit plugins", () => {
  test("flags direct calls and any scoped value/alias/member/re-export reference (conditionals, arrays, objects, arguments, returns) at error severity while allowing non-React objects, useEffectEvent, and exempt paths in both apps", () => {
    const badSample = [
      'import * as R from "react";',
      "import React, {",
      "  useEffect,",
      "  useEffect as ue,",
      '  "useEffect" as qe,',
      "  useEffectEvent,",
      "  useLayoutEffect,",
      "  useLayoutEffect as ule,",
      '} from "react";',
      'import { useMountEffect, useMountEffect as ume, "useMountEffect" as qm } from "@/hooks/use-mount-effect";',
      'export { useEffect as reexportedEffect, "useEffect" as reQuotedEffect } from "react";',
      'export { useLayoutEffect as reexportedLayoutEffect, useState as okReexport } from "react";',
      'export { useMountEffect as reexportedMountEffect } from "@/hooks/use-mount-effect";',
      "export { useEffect as localReexport, useEffectEvent as okLocalReexport };",
      "",
      "export const useIsomorphicLayoutEffect =",
      '  typeof window === "undefined" ? useEffect : useLayoutEffect;',
      "export const nsConditional =",
      '  typeof window === "undefined" ? R.useEffect : R.useLayoutEffect;',
      "export const reactConditional =",
      '  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;',
      "",
      "export function Sample(run: (fn: unknown) => unknown) {",
      "  const onTick = useEffectEvent(() => {});",
      "  const { useEffect: destructuredEffect } = R;",
      "  let { useLayoutEffect: destructuredLayout } = React;",
      "  const { useMountEffect: destructuredMount } = R;",
      "  const { useEffectEvent: okEvent } = R;",
      "  const arr = [useEffect, useMountEffect, R.useEffect, React.useLayoutEffect];",
      "  const obj = { fn: useEffect, useLayoutEffect, ns: R.useMountEffect, r: React.useEffect };",
      "  run(useEffect);",
      "  run(R.useEffect);",
      "  run(React.useMountEffect);",
      "  const assignedEffect = useEffect;",
      "  const assignedMember = R.useLayoutEffect;",
      '  const assignedComputed = R["useMountEffect"];',
      "  const returned = () => useEffect;",
      "  useEffect(() => {",
      "    onTick();",
      "  }, [onTick]);",
      "  useLayoutEffect(() => {}, []);",
      "  useMountEffect(() => {});",
      "  useEffect?.(() => {}, []);",
      "  React.useEffect(() => {}, []);",
      "  React.useLayoutEffect(() => {});",
      "  React.useMountEffect(() => {});",
      "  React.useEffect?.(() => {}, []);",
      "  R.useEffect(() => {}, []);",
      "  R.useEffect?.(() => {}, []);",
      "  R.useLayoutEffect(() => {});",
      '  React["useEffect"](() => {}, []);',
      "  React['useLayoutEffect'](() => {});",
      '  R["useMountEffect"]?.(() => {});',
      "  return [ue, qe, ule, ume, qm, destructuredEffect, destructuredLayout, destructuredMount, okEvent, arr, obj, assignedEffect, assignedMember, assignedComputed, returned];",
      "}",
      "",
    ].join("\n");

    const cleanNonReactSample = [
      'import type * as R from "react";',
      'import { useEffectEvent, useState } from "react";',
      "",
      "export function Safe(",
      "  options: { useEffect: boolean },",
      "  api: { useEffect: () => void },",
      "  run: (x: unknown) => void,",
      "): R.ReactNode {",
      "  const { useEffect } = options;",
      "  const copiedFlag = useEffect;",
      '  const conditionalFlag = typeof window === "undefined" ? useEffect : false;',
      "  const arr = [useEffect];",
      "  const obj = { fn: useEffect, useEffect };",
      "  run(useEffect);",
      "  const onTick = useEffectEvent(() => {});",
      "  if (copiedFlag && conditionalFlag) api.useEffect();",
      "  onTick();",
      "  const [count] = useState(0);",
      "  return [arr, obj, count];",
      "}",
      "",
    ].join("\n");

    // 7 direct calls (`no-direct-effects.grit`):
    //   useEffect, useLayoutEffect, useMountEffect, useEffect?.,
    //   React.useEffect, React.useLayoutEffect, React.useMountEffect
    // 41 alias/value/indirection matches (`no-effect-aliases.grit`):
    //   5 import aliases + 5 renamed re-exports
    //   + 6 conditional value refs (useEffect, useLayoutEffect, R.useEffect, R.useLayoutEffect, React.useEffect, React.useLayoutEffect)
    //   + 3 destructurings
    //   + 4 array value refs + 4 object value refs + 3 function argument value refs
    //   + 3 assignments + 1 arrow return value ref
    //   + 7 namespace/computed/optional calls
    const expectedCount = 48;

    for (const app of APPS) {
      const fixture = mkdtempSync(join(tmpdir(), `effect-rule-${app.name}-`));
      try {
        writeTempPlugins(fixture);

        const appRoot = join(fixture, "apps", app.name);
        const appFiles = [
          ["src/clean.tsx", badSample],
          ["src/non-react-ok.tsx", cleanNonReactSample],
          ["src/hooks/effects/use-sample.ts", badSample],
          ["src/sample.test.tsx", badSample],
          ["src/sample.spec.tsx", badSample],
          ["src/__tests__/helper.tsx", badSample],
          ["src/test/helper.tsx", badSample],
          ["src/test-fixtures/fixture.tsx", badSample],
          ["src/components/fixtures/fixture.tsx", badSample],
          ["src/components/demo-fixture.tsx", badSample],
          ...(app.exemptUi
            ? [["src/components/ui/button.tsx", badSample]]
            : []),
        ];

        for (const [rel, content] of appFiles) {
          const full = join(appRoot, rel);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content);
        }

        writeFileSync(join(appRoot, "effect-baseline.json"), "{}\n");
        syncAppEffectBaseline(app, { rootDir: fixture });

        const appBiome = {
          root: false,
          extends: [ROOT_BIOME_EXTEND_PATH, GENERATED_BIOME_EXTEND_PATH],
          ...(app.exemptUi
            ? { files: { includes: ["**", "!src/components/ui/**"] } }
            : {}),
          overrides: [
            {
              includes: app.baseIncludes,
              plugins: [ALIAS_PLUGIN_REL_FROM_APP],
            },
          ],
        };
        writeFileSync(
          join(appRoot, "biome.json"),
          JSON.stringify(appBiome, null, 2),
        );

        const report = runBiomeJson(
          ["lint", "--reporter=json", "--max-diagnostics=none", "."],
          fixture,
        );
        const pluginDiagnostics = report.diagnostics.filter(
          (d) => d.category === "plugin",
        );

        assert.equal(
          pluginDiagnostics.length,
          expectedCount,
          `${app.name}: expected ${expectedCount} errors from src/clean.tsx only, got ${pluginDiagnostics.length}: ${JSON.stringify(pluginDiagnostics)}`,
        );
        for (const diagnostic of pluginDiagnostics) {
          assert.equal(diagnostic.severity, "error");
          assert.equal(diagnostic.message, EXPECTED_MESSAGE);
          assert.equal(
            toPosixPath(diagnostic.location.path),
            `apps/${app.name}/src/clean.tsx`,
          );
        }
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  });

  test("never grandfathers aliases or conditional value refs in a baselined file", () => {
    const fixture = mkdtempSync(join(tmpdir(), "effect-baselined-alias-"));
    try {
      writeTempPlugins(fixture);
      const appDir = join(fixture, "apps/web");
      mkdirSync(join(appDir, "src"), { recursive: true });
      writeFileSync(
        join(appDir, "src/legacy.tsx"),
        [
          'import { useEffect, useEffect as ue, useLayoutEffect } from "react";',
          "const useIsomorphicLayoutEffect =",
          '  typeof window === "undefined" ? useEffect : useLayoutEffect;',
          "export function Legacy() {",
          "  useEffect(() => {}, []);",
          "  ue(() => {}, []);",
          "  useIsomorphicLayoutEffect(() => {}, []);",
          "  return null;",
          "}",
          "",
        ].join("\n"),
      );
      writeFileSync(
        join(appDir, "effect-baseline.json"),
        formatEffectBaseline({ "src/legacy.tsx": 1 }),
      );
      syncAppEffectBaseline(
        {
          name: "web",
          relDir: "apps/web",
          baseIncludes: COMMON_BASE_INCLUDES,
          exemptUi: false,
        },
        { rootDir: fixture },
      );
      writeFileSync(
        join(appDir, "biome.json"),
        JSON.stringify({
          root: false,
          extends: [ROOT_BIOME_EXTEND_PATH, GENERATED_BIOME_EXTEND_PATH],
          overrides: [
            {
              includes: COMMON_BASE_INCLUDES,
              plugins: [ALIAS_PLUGIN_REL_FROM_APP],
            },
          ],
        }),
      );

      // Biome itself flags both the import alias and the conditional value refs
      // inside the baselined file (1 import alias + 2 conditional refs = 3).
      const report = runBiomeJson(
        ["lint", "--reporter=json", "--max-diagnostics=none", "."],
        appDir,
      );
      const pluginErrors = report.diagnostics.filter(
        (d) => d.category === "plugin",
      );
      assert.equal(pluginErrors.length, 3);
      for (const error of pluginErrors) {
        assert.equal(error.severity, "error");
      }

      // And the seam checker rejects them even though the direct call count is 1.
      const { aliases, violations } = checkAppDir({
        name: "web",
        dir: appDir,
        baseIncludes: COMMON_BASE_INCLUDES,
        exemptUi: false,
      });
      assert.deepEqual(violations, []);
      assert.equal(aliases.length, 1);
      assert.match(aliases[0], /src\/legacy\.tsx.*3 forbidden/);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("rejects every real Biome suppression form for the effect plugins end-to-end and ignores directive text inside string literals", () => {
    const suppressionFixtures = [
      [
        "line-lint",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-value",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint(anything): bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-plugin",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/plugin: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-plugin-value",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/plugin(anything): bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-plugin-named",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/plugin/no-direct-effects: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-plugin-named-value",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/plugin/no-direct-effects(anything): bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-plugin-alias-named",
        'import { useEffect as ue } from "react";\nexport function A() {\n  // biome-ignore lint/plugin/no-effect-aliases: bypass\n  const x = ue;\n  return x;\n}\n',
      ],
      [
        "file-all-lint-plugin-named",
        '// biome-ignore-all lint/plugin/no-direct-effects: bypass\nimport { useEffect } from "react";\nexport function A() {\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "range-start-lint-plugin-named",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore-start lint/plugin/no-direct-effects: bypass\n  useEffect(() => {}, []);\n  // biome-ignore-end lint/plugin/no-direct-effects: bypass\n  return null;\n}\n',
      ],
      [
        "block-comment-named",
        'import { useEffect } from "react";\nexport function A() {\n  /* biome-ignore lint/plugin/no-direct-effects(x): bypass */\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "second-category-lint-plugin",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/correctness/noUnusedVariables lint/plugin: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "second-category-lint-plugin-named",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/correctness/noUnusedVariables lint/plugin/no-direct-effects(foo): bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "second-category-lint",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/correctness/noUnusedVariables lint: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "after-jsx-apostrophe",
        'import { useEffect } from "react";\nexport function A() {\n  const el = <div>Don\'t hide comments</div>;\n  // biome-ignore lint/plugin/no-direct-effects: bypass\n  useEffect(() => {}, []);\n  return el;\n}\n',
      ],
    ];

    const fixture = mkdtempSync(join(tmpdir(), "effect-suppress-e2e-"));
    try {
      writeTempPlugins(fixture);

      for (const [name, source] of suppressionFixtures) {
        const appDir = join(fixture, "apps", name);
        mkdirSync(join(appDir, "src"), { recursive: true });
        writeFileSync(join(appDir, "src/bypass.tsx"), source);
        writeFileSync(join(appDir, "effect-baseline.json"), "{}\n");
        syncAppEffectBaseline(
          {
            name,
            relDir: `apps/${name}`,
            baseIncludes: COMMON_BASE_INCLUDES,
            exemptUi: false,
          },
          { rootDir: fixture },
        );
        writeFileSync(
          join(appDir, "biome.json"),
          JSON.stringify({
            root: false,
            extends: [ROOT_BIOME_EXTEND_PATH, GENERATED_BIOME_EXTEND_PATH],
            overrides: [
              {
                includes: COMMON_BASE_INCLUDES,
                plugins: [ALIAS_PLUGIN_REL_FROM_APP],
              },
            ],
          }),
        );

        // For the alias fixture, the import line itself is unsuppressed; all
        // other fixtures suppress the effect call directly and must produce 0
        // plugin diagnostics from Biome to prove the suppression is real.
        if (name !== "line-lint-plugin-alias-named") {
          const report = runBiomeJson(
            ["lint", "--reporter=json", "--max-diagnostics=none", "."],
            appDir,
          );
          const pluginErrors = report.diagnostics.filter(
            (d) => d.category === "plugin",
          );
          assert.equal(
            pluginErrors.length,
            0,
            `${name}: expected Biome to silence plugin error so the suppression guard is exercised`,
          );
        }

        const { suppressions } = checkAppDir({
          name,
          dir: appDir,
          baseIncludes: COMMON_BASE_INCLUDES,
          exemptUi: false,
        });
        assert.equal(
          suppressions.length,
          1,
          `${name}: expected suppression check to fail on real Biome suppression`,
        );
      }

      // String literals containing directive text are NOT comments and must pass.
      const stringAppDir = join(fixture, "apps/string-literal");
      mkdirSync(join(stringAppDir, "src"), { recursive: true });
      writeFileSync(
        join(stringAppDir, "src/docs.ts"),
        [
          'export const a = "// biome-ignore lint/plugin/no-direct-effects: example";',
          "export const b = '/* biome-ignore lint/plugin(x): example */';",
          "export const c = `\n// biome-ignore-all lint: example\n`;",
          "",
        ].join("\n"),
      );
      writeFileSync(join(stringAppDir, "effect-baseline.json"), "{}\n");
      syncAppEffectBaseline(
        {
          name: "string-literal",
          relDir: "apps/string-literal",
          baseIncludes: COMMON_BASE_INCLUDES,
          exemptUi: false,
        },
        { rootDir: fixture },
      );
      writeFileSync(
        join(stringAppDir, "biome.json"),
        JSON.stringify({
          root: false,
          extends: [ROOT_BIOME_EXTEND_PATH, GENERATED_BIOME_EXTEND_PATH],
          overrides: [
            {
              includes: COMMON_BASE_INCLUDES,
              plugins: [ALIAS_PLUGIN_REL_FROM_APP],
            },
          ],
        }),
      );
      const { suppressions, violations, aliases } = checkAppDir({
        name: "string-literal",
        dir: stringAppDir,
        baseIncludes: COMMON_BASE_INCLUDES,
        exemptUi: false,
      });
      assert.deepEqual(suppressions, []);
      assert.deepEqual(violations, []);
      assert.deepEqual(aliases, []);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });

  test("derives .effect-baseline.biome.json from effect-baseline.json, escapes bracketed paths, preserves app plugins and root rules, and immediately flags newly cleaned files", () => {
    const fixture = mkdtempSync(join(tmpdir(), "effect-sync-e2e-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: fixture });
      writeFileSync(
        join(fixture, ".gitignore"),
        `apps/*/${GENERATED_BIOME_FILENAME}\n`,
      );
      writeTempPlugins(fixture);
      writeFileSync(
        join(fixture, "biome.jsonc"),
        readFileSync(join(ROOT, "biome.jsonc"), "utf8"),
      );
      const appDir = join(fixture, "apps/web");
      const bracketedRel = "src/app/(app)/agents/[agentId]/page.tsx";
      const cleanRel = "src/clean.tsx";
      const zeroEntryRel = "src/zero.tsx";
      const effectSource =
        'import { useEffect } from "react";\n\nexport function Demo() {\n  useEffect(() => {}, []);\n  return null;\n}\n';

      mkdirSync(join(appDir, "biome-plugins"), { recursive: true });
      writeFileSync(
        join(appDir, "biome-plugins/named-clock-formats.grit"),
        readFileSync(
          join(ROOT, "apps/web/biome-plugins/named-clock-formats.grit"),
          "utf8",
        ),
      );
      mkdirSync(dirname(join(appDir, bracketedRel)), { recursive: true });
      writeFileSync(join(appDir, bracketedRel), effectSource);
      writeFileSync(join(appDir, cleanRel), effectSource);
      writeFileSync(join(appDir, zeroEntryRel), effectSource);
      writeFileSync(
        join(appDir, "src/clock-and-unused.ts"),
        'export function formatClock(formatter: { dateTime: (v: Date, o: object) => string }) {\n  const unused = 1;\n  return formatter.dateTime(new Date(), { hour: "numeric" });\n}\n',
      );
      writeFileSync(
        join(appDir, "biome.json"),
        readFileSync(join(ROOT, "apps/web/biome.json"), "utf8"),
      );

      // Bracketed path is baselined (count 1); zeroEntryRel has count 0 and
      // must NOT be exempted even before the baseline invariant check runs.
      const app = { ...EFFECT_APPS[0] };
      writeFileSync(
        join(appDir, "effect-baseline.json"),
        formatEffectBaseline({
          [bracketedRel]: 1,
          [zeroEntryRel]: 0,
        }),
      );
      const firstSync = syncAppEffectBaseline(app, { rootDir: fixture });
      assert.equal(firstSync.changed, true);
      const secondSync = syncAppEffectBaseline(app, { rootDir: fixture });
      assert.equal(secondSync.changed, false);

      const initialReport = runBiomeJson(
        ["lint", "--reporter=json", "--max-diagnostics=none", "."],
        fixture,
      );
      const initialEffectPaths = initialReport.diagnostics
        .filter(
          (d) => d.category === "plugin" && d.message === EXPECTED_MESSAGE,
        )
        .map((d) => toPosixPath(d.location.path))
        .sort();
      assert.deepEqual(initialEffectPaths, [
        `apps/web/${cleanRel}`,
        `apps/web/${zeroEntryRel}`,
      ]);
      // App plugin (`named-clock-formats`) and root rule (`noUnusedVariables`)
      // stay active alongside the extended generated baseline override.
      assert.ok(
        initialReport.diagnostics.some(
          (d) =>
            d.category === "plugin" &&
            d.message.includes("named dateTime format") &&
            toPosixPath(d.location.path) === "apps/web/src/clock-and-unused.ts",
        ),
        "expected named-clock-formats.grit to stay active",
      );
      assert.ok(
        initialReport.diagnostics.some(
          (d) =>
            d.category === "lint/correctness/noUnusedVariables" &&
            toPosixPath(d.location.path) === "apps/web/src/clock-and-unused.ts",
        ),
        "expected root noUnusedVariables to stay active",
      );

      // Removing the bracketed path from effect-baseline.json and re-syncing
      // makes Biome immediately flag it with no biome.json edits.
      writeFileSync(join(appDir, "effect-baseline.json"), "{}\n");
      const thirdSync = syncAppEffectBaseline(app, { rootDir: fixture });
      assert.equal(thirdSync.changed, true);

      const afterDropReport = runBiomeJson(
        ["lint", "--reporter=json", "--max-diagnostics=none", "."],
        fixture,
      );
      const afterDropPaths = afterDropReport.diagnostics
        .filter(
          (d) => d.category === "plugin" && d.message === EXPECTED_MESSAGE,
        )
        .map((d) => toPosixPath(d.location.path))
        .sort();
      assert.deepEqual(afterDropPaths, [
        `apps/web/${bracketedRel}`,
        `apps/web/${cleanRel}`,
        `apps/web/${zeroEntryRel}`,
      ]);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});

describe("effect baseline invariants", () => {
  const baseIncludes = ["src/**", "!src/hooks/effects/**"];

  test("fails on a new effect in a non-baselined file", () => {
    const errors = findBaselineViolations({
      actualCounts: new Map([["src/new-component.tsx", 1]]),
      baseline: {},
      aliasOverrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /non-baselined file/);
  });

  test("fails on a baselined file whose count grows", () => {
    const errors = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 3]]),
      baseline: { "src/existing.tsx": 2 },
      aliasOverrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /grew from 2 to 3/);
  });

  test("fails on a zero-count entry left in the baseline", () => {
    const explicitZero = findBaselineViolations({
      actualCounts: new Map(),
      baseline: { "src/migrated.tsx": 0 },
      aliasOverrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(explicitZero.length, 1);
    assert.match(explicitZero[0], /positive integer/);

    const staleEntry = findBaselineViolations({
      actualCounts: new Map(),
      baseline: { "src/migrated.tsx": 1 },
      aliasOverrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(staleEntry.length, 1);
    assert.match(staleEntry[0], /has 0 direct effects/);
  });

  test("fails when a baselined file shrinks without lowering the baseline", () => {
    const errors = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 1]]),
      baseline: { "src/existing.tsx": 2 },
      aliasOverrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /dropped from 2 to 1/);
  });

  test("fails when biome.json drops the generated extend, inlines direct-effects, or grandfathers aliases", () => {
    const missingExtend = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 1]]),
      baseline: { "src/existing.tsx": 1 },
      biomeExtends: "//",
      aliasOverrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(missingExtend.length, 1);
    assert.match(missingExtend[0], /must extend/);

    const inlineDirect = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 1]]),
      baseline: { "src/existing.tsx": 1 },
      hasDirectPluginInBiome: true,
      aliasOverrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(inlineDirect.length, 1);
    assert.match(inlineDirect[0], /must not inline/);

    const aliasDrift = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 1]]),
      baseline: { "src/existing.tsx": 1 },
      aliasOverrideIncludes: [...baseIncludes, "!src/existing.tsx"],
      baseIncludes,
    });
    assert.equal(aliasDrift.length, 1);
    assert.match(aliasDrift[0], /no baselined exemptions/);
  });

  test("fails when effect-baseline.json is unsorted or not formatted one entry per line", () => {
    const unsortedRaw = '{\n  "src/b.tsx": 1,\n  "src/a.tsx": 1\n}\n';
    const unsorted = findBaselineFormatViolations(
      unsortedRaw,
      JSON.parse(unsortedRaw),
    );
    assert.ok(unsorted.some((e) => /sorted/.test(e)));

    const singleLineRaw = '{"src/a.tsx": 1, "src/b.tsx": 1}\n';
    const singleLine = findBaselineFormatViolations(
      singleLineRaw,
      JSON.parse(singleLineRaw),
    );
    assert.equal(singleLine.length, 1);
    assert.match(singleLine[0], /one entry per line/);

    const canonicalRaw = formatEffectBaseline({
      "src/b.tsx": 2,
      "src/a.tsx": 1,
    });
    assert.equal(canonicalRaw, '{\n  "src/a.tsx": 1,\n  "src/b.tsx": 2\n}\n');
    assert.deepEqual(
      findBaselineFormatViolations(canonicalRaw, JSON.parse(canonicalRaw)),
      [],
    );
  });

  test("fails on any baseline increase relative to the base branch", () => {
    assert.deepEqual(
      findBaselineGrowth({ "src/a.tsx": 1 }, { "src/a.tsx": 2 }),
      [],
    );
    assert.deepEqual(findBaselineGrowth({}, { "src/a.tsx": 1 }), []);
    const grew = findBaselineGrowth(
      { "src/a.tsx": 3, "src/new.tsx": 1 },
      { "src/a.tsx": 2 },
    );
    assert.equal(grew.length, 2);
    assert.match(grew[0], /src\/a\.tsx.*grew from 2 to 3/);
    assert.match(grew[1], /src\/new\.tsx.*grew from 0 to 1/);
  });

  test("allows unrelated suppressions, prose, and string literals while rejecting all effect-rule suppressions in comments", () => {
    const findings = findEffectSuppressionsInFiles(
      new Map([
        [
          "src/mixed.tsx",
          [
            'const ignoredString = "// biome-ignore lint/plugin/no-direct-effects: in string";',
            "const ignoredSingle = '/* biome-ignore lint/plugin(foo): in string */';",
            "const ignoredTemplate = `// biome-ignore lint: in template`;",
            "// biome-ignore lint: bypass",
            "// biome-ignore lint(val): bypass",
            "// biome-ignore lint/plugin: bypass",
            "// biome-ignore lint/plugin(val): bypass",
            "// biome-ignore lint/plugin/no-direct-effects: bypass",
            "// biome-ignore lint/plugin/no-direct-effects(val): bypass",
            "// biome-ignore lint/plugin/no-effect-aliases(val): bypass",
            "// biome-ignore-all lint/plugin/no-direct-effects(val): bypass",
            "// biome-ignore-start lint/plugin/no-direct-effects: bypass",
            "/* biome-ignore lint/correctness/noUnusedVariables lint/plugin/no-direct-effects(x y): bypass */",
            "// biome-ignore lint/correctness/noUnusedVariables: unrelated",
            "// biome-ignore lint/plugin/named-clock-formats: unrelated plugin",
            "// `biome-ignore` in prose is fine",
          ].join("\n"),
        ],
      ]),
    );
    assert.equal(findings.length, 10);
  });

  test("readBaseBaseline bootstraps only on a valid commit predating the file and throws on invalid refs or JSON", () => {
    const repo = mkdtempSync(join(tmpdir(), "effect-base-ref-"));
    const env = {
      ...Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
      ),
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    };
    const git = (...args) =>
      execFileSync("git", args, { cwd: repo, env, encoding: "utf8" }).trim();

    try {
      git("init", "-q");
      writeFileSync(join(repo, "README.md"), "before baseline\n");
      git("add", "-f", ".");
      git("commit", "-q", "-m", "predates baseline");
      const preBaselineSha = git("rev-parse", "HEAD");

      assert.equal(
        readBaseBaseline(preBaselineSha, "web", { cwd: repo, env }),
        null,
      );

      assert.throws(
        () =>
          readBaseBaseline("refs/heads/does-not-exist", "web", {
            cwd: repo,
            env,
          }),
        /Invalid EFFECT_BASELINE_BASE_REF/,
      );

      mkdirSync(join(repo, "apps/web"), { recursive: true });
      writeFileSync(
        join(repo, "apps/web/effect-baseline.json"),
        '{"src/a.tsx": 2}\n',
      );
      git("add", "-f", ".");
      git("commit", "-q", "-m", "valid baseline");
      const validSha = git("rev-parse", "HEAD");
      assert.deepEqual(readBaseBaseline(validSha, "web", { cwd: repo, env }), {
        "src/a.tsx": 2,
      });

      writeFileSync(join(repo, "apps/web/effect-baseline.json"), "{not-json");
      git("add", "-f", ".");
      git("commit", "-q", "-m", "corrupt baseline");
      const corruptSha = git("rev-parse", "HEAD");
      assert.throws(
        () => readBaseBaseline(corruptSha, "web", { cwd: repo, env }),
        SyntaxError,
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

describe("live repo effect baseline", () => {
  for (const app of APPS) {
    test(`apps/${app.name} matches its effect-baseline.json with no suppressions or aliases`, () => {
      const { baseline, suppressions, aliases, violations } = checkAppDir(app);

      assert.deepEqual(
        suppressions,
        [],
        `apps/${app.name} has forbidden biome-ignore suppression(s) for the effect rule:\n${suppressions.join("\n")}`,
      );

      assert.deepEqual(
        aliases,
        [],
        `apps/${app.name} has forbidden effect alias/indirection match(es):\n${aliases.join("\n")}`,
      );

      assert.deepEqual(
        violations,
        [],
        `apps/${app.name} effect baseline violations:\n${violations.join("\n")}`,
      );

      const baseRef = process.env.EFFECT_BASELINE_BASE_REF;
      if (baseRef) {
        const baseBaseline = readBaseBaseline(baseRef, app.name);
        if (baseBaseline) {
          const growth = findBaselineGrowth(baseline, baseBaseline);
          assert.deepEqual(
            growth,
            [],
            `apps/${app.name} effect baseline grew against ${baseRef}:\n${growth.join("\n")}`,
          );
        }
      }
    });
  }

  test("repo scripts, CI, gitignore, and hooks keep the generated Biome baseline synced automatically", () => {
    const gitignore = readFileSync(join(ROOT, ".gitignore"), "utf8");
    assert.match(
      gitignore,
      /^apps\/\*\/\.effect-baseline\.biome\.json$/m,
      ".gitignore must ignore generated apps/*/.effect-baseline.biome.json",
    );

    const postMerge = readFileSync(join(ROOT, ".husky/post-merge"), "utf8");
    assert.match(
      postMerge,
      /sync-effect-baseline\.mjs/,
      ".husky/post-merge must re-sync when effect-baseline.json changes",
    );

    const rootPkg = JSON.parse(
      readFileSync(join(ROOT, "package.json"), "utf8"),
    );
    for (const script of [
      "prepare",
      "check",
      "check:write",
      "lint",
      "lint:write",
      "format",
      "format:check",
    ]) {
      assert.match(
        rootPkg.scripts[script] ?? "",
        /sync-effect-baseline\.mjs/,
        `root package.json script "${script}" must run sync-effect-baseline.mjs`,
      );
    }

    for (const app of EFFECT_APPS) {
      const appPkg = JSON.parse(
        readFileSync(join(ROOT, app.relDir, "package.json"), "utf8"),
      );
      for (const [name, cmd] of Object.entries(appPkg.scripts ?? {})) {
        if (/\bbiome\b/.test(cmd)) {
          assert.match(
            cmd,
            /sync-effect-baseline\.mjs/,
            `${app.relDir}/package.json script "${name}" must run sync-effect-baseline.mjs before biome`,
          );
        }
      }
    }

    const ciYml = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const syncIdx = ciYml.indexOf("node scripts/ci/sync-effect-baseline.mjs");
    const biomeIdx = ciYml.indexOf("run: biome check .");
    assert.ok(
      syncIdx !== -1,
      ".github/workflows/ci.yml must run sync-effect-baseline.mjs",
    );
    assert.ok(
      syncIdx < biomeIdx,
      ".github/workflows/ci.yml must sync the effect baseline before running biome check .",
    );
  });
});
