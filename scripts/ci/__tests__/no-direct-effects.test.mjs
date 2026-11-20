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
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const PLUGIN_REL_FROM_APP = "../../biome-plugins/no-direct-effects.grit";
const PLUGIN_PATH = join(ROOT, "biome-plugins/no-direct-effects.grit");

const EXPECTED_MESSAGE =
  "Effects live only in src/hooks/effects/. Compute during render, use an event handler, reset with key, or call a named hook from that folder. See docs/agents/web-ui.md#effects.";

const COMMON_BASE_INCLUDES = [
  "src/**",
  "!src/hooks/effects/**",
  "!**/*.test.*",
  "!**/*.spec.*",
  "!**/__tests__/**",
  "!src/test/**",
  "!src/test-fixtures/**",
  "!**/fixtures/**",
  "!**/*-fixture.*",
  "!**/*-fixtures.*",
  "!**/*.fixture.*",
  "!**/*.fixtures.*",
  "!**/fixtures.*",
  "!**/fixture-*.*",
];

const APPS = [
  {
    name: "web",
    dir: join(ROOT, "apps/web"),
    baseIncludes: [
      COMMON_BASE_INCLUDES[0],
      COMMON_BASE_INCLUDES[1],
      "!src/components/ui/**",
      ...COMMON_BASE_INCLUDES.slice(2),
    ],
    exemptUi: true,
  },
  {
    name: "cmo",
    dir: join(ROOT, "apps/cmo"),
    baseIncludes: [...COMMON_BASE_INCLUDES],
    exemptUi: false,
  },
];

// Captures the category list of any Biome suppression directive up to `:`,
// `*/`, or end-of-line so multi-category headers (e.g.
// `biome-ignore lint/correctness/noUnusedVariables lint/plugin/no-direct-effects: ...`)
// are inspected category by category.
const BIOME_SUPPRESSION_HEADER_RE =
  /\bbiome-ignore(?:-(?:all|start))?[ \t]+([^:\n<]+?)(?=:|<|\*\/|$)/g;

const FORBIDDEN_SUPPRESSION_CATEGORY_RE =
  /^(?:lint|lint\/plugin|lint\/plugin\/no-direct-effects|plugin|plugin\/no-direct-effects|no-direct-effects)$/;

const SCRIPT_FILE_RE = /\.(?:[cm]?[jt]sx?)$/;

function resolveBiomeBin() {
  const local = join(ROOT, "node_modules/.bin/biome");
  return existsSync(local) ? local : "biome";
}

function escapeBiomeGlob(relPath) {
  return relPath.replace(/[[\]]/g, "\\$&");
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
 * Counts direct effect calls per checked product file in `app.dir` by running
 * Biome with only `no-direct-effects.grit` and no baseline exclusions.
 */
function countActualEffects(app) {
  const tempConfigDir = mkdtempSync(join(tmpdir(), "effect-count-"));
  try {
    writeFileSync(
      join(tempConfigDir, "no-direct-effects.grit"),
      readFileSync(PLUGIN_PATH, "utf8"),
    );
    writeFileSync(
      join(tempConfigDir, "biome.json"),
      JSON.stringify({
        linter: { enabled: true, rules: { preset: "none" } },
        plugins: ["./no-direct-effects.grit"],
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

function findEffectSuppressionsInFiles(filesByRelPath) {
  const findings = [];
  for (const [relPath, text] of filesByRelPath) {
    text.split("\n").forEach((line, index) => {
      for (const match of line.matchAll(BIOME_SUPPRESSION_HEADER_RE)) {
        const categories = match[1].trim().split(/[ \t]+/);
        for (const category of categories) {
          if (FORBIDDEN_SUPPRESSION_CATEGORY_RE.test(category)) {
            findings.push(`${relPath}:${index + 1} ${match[0].trim()}`);
            break;
          }
        }
      }
    });
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

function findBaselineViolations({
  actualCounts,
  baseline,
  overrideIncludes,
  baseIncludes,
}) {
  const errors = [];

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
        `${file}: has 0 direct effects; remove it from effect-baseline.json and biome.json.`,
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

  const expectedIncludes = [
    ...baseIncludes,
    ...Object.keys(baseline)
      .sort()
      .map((file) => `!${escapeBiomeGlob(file)}`),
  ];
  if (JSON.stringify(overrideIncludes) !== JSON.stringify(expectedIncludes)) {
    errors.push(
      "biome.json effect-rule override includes do not match effect-baseline.json.",
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

  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const biomeConfig = JSON.parse(readFileSync(biomePath, "utf8"));
  const effectOverride = (biomeConfig.overrides ?? []).find(
    (override) =>
      Array.isArray(override.plugins) &&
      override.plugins.includes(PLUGIN_REL_FROM_APP),
  );
  assert.ok(
    effectOverride,
    `apps/${app.name}/biome.json must attach ${PLUGIN_REL_FROM_APP} via an override`,
  );

  const suppressions = findEffectSuppressions(app);
  const actualCounts = countActualEffects(app);
  const violations = findBaselineViolations({
    actualCounts,
    baseline,
    overrideIncludes: effectOverride.includes ?? [],
    baseIncludes: app.baseIncludes,
  });

  return { baseline, suppressions, violations };
}

describe("no-direct-effects Grit plugin", () => {
  test("flags named imports, React.*, namespace, computed-member, alias, destructuring, and renamed re-export forms at error severity and passes exempt paths in both apps", () => {
    const sample = [
      'import * as R from "react";',
      "import React, {",
      "  useEffect,",
      "  useEffect as ue,",
      "  useEffectEvent,",
      "  useLayoutEffect,",
      "  useLayoutEffect as ule,",
      '} from "react";',
      'import { useMountEffect, useMountEffect as ume } from "@/hooks/use-mount-effect";',
      'export { useEffect as reexportedEffect } from "react";',
      'export { useLayoutEffect as reexportedLayoutEffect, useState as okReexport } from "react";',
      'export { useMountEffect as reexportedMountEffect } from "@/hooks/use-mount-effect";',
      "export { useEffect as localReexport, useEffectEvent as okLocalReexport };",
      "",
      "export function Sample() {",
      "  const onTick = useEffectEvent(() => {});",
      "  const { useEffect: destructuredEffect } = R;",
      "  let { useLayoutEffect: destructuredLayout } = React;",
      "  const { useMountEffect: destructuredMount } = R;",
      "  const { useEffectEvent: okEvent } = R;",
      "  const assignedEffect = useEffect;",
      "  const assignedMember = R.useLayoutEffect;",
      '  const assignedComputed = R["useMountEffect"];',
      "  useEffect(() => {",
      "    onTick();",
      "  }, [onTick]);",
      "  useLayoutEffect(() => {}, []);",
      "  useMountEffect(() => {});",
      "  React.useEffect(() => {}, []);",
      "  React.useLayoutEffect(() => {});",
      "  React.useMountEffect(() => {});",
      "  R.useEffect(() => {}, []);",
      "  R.useLayoutEffect(() => {});",
      '  React["useEffect"](() => {}, []);',
      "  React['useLayoutEffect'](() => {});",
      '  R["useMountEffect"](() => {});',
      "  return [ue, ule, ume, destructuredEffect, destructuredLayout, destructuredMount, okEvent, assignedEffect, assignedMember, assignedComputed];",
      "}",
      "",
    ].join("\n");

    // 3 import aliases + 4 renamed re-exports + 3 destructurings + 3 assignments + 11 calls = 24 errors.
    const expectedCount = 24;

    for (const app of APPS) {
      const fixture = mkdtempSync(join(tmpdir(), `effect-rule-${app.name}-`));
      try {
        mkdirSync(join(fixture, "biome-plugins"), { recursive: true });
        writeFileSync(
          join(fixture, "biome-plugins/no-direct-effects.grit"),
          readFileSync(PLUGIN_PATH, "utf8"),
        );
        writeFileSync(
          join(fixture, "biome.jsonc"),
          JSON.stringify({
            linter: { enabled: true, rules: { preset: "none" } },
          }),
        );

        const appRoot = join(fixture, "apps", app.name);
        const appFiles = [
          "src/clean.tsx",
          "src/hooks/effects/use-sample.ts",
          "src/sample.test.tsx",
          "src/sample.spec.tsx",
          "src/__tests__/helper.tsx",
          "src/test/helper.tsx",
          "src/test-fixtures/fixture.tsx",
          "src/components/fixtures/fixture.tsx",
          "src/components/demo-fixture.tsx",
          ...(app.exemptUi ? ["src/components/ui/button.tsx"] : []),
        ];

        for (const rel of appFiles) {
          const full = join(appRoot, rel);
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, sample);
        }

        const appBiome = {
          root: false,
          extends: "//",
          ...(app.exemptUi
            ? { files: { includes: ["**", "!src/components/ui/**"] } }
            : {}),
          overrides: [
            {
              includes: app.baseIncludes,
              plugins: [PLUGIN_REL_FROM_APP],
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

  test("rejects every real Biome suppression form for no-direct-effects end-to-end", () => {
    const suppressionFixtures = [
      [
        "line-lint",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-plugin",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/plugin: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "line-lint-plugin-named",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/plugin/no-direct-effects: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
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
        'import { useEffect } from "react";\nexport function A() {\n  /* biome-ignore lint/plugin/no-direct-effects: bypass */\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "second-category-lint-plugin",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/correctness/noUnusedVariables lint/plugin: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "second-category-lint-plugin-named",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/correctness/noUnusedVariables lint/plugin/no-direct-effects: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
      [
        "second-category-lint",
        'import { useEffect } from "react";\nexport function A() {\n  // biome-ignore lint/correctness/noUnusedVariables lint: bypass\n  useEffect(() => {}, []);\n  return null;\n}\n',
      ],
    ];

    const fixture = mkdtempSync(join(tmpdir(), "effect-suppress-e2e-"));
    try {
      mkdirSync(join(fixture, "biome-plugins"), { recursive: true });
      writeFileSync(
        join(fixture, "biome-plugins/no-direct-effects.grit"),
        readFileSync(PLUGIN_PATH, "utf8"),
      );
      writeFileSync(
        join(fixture, "biome.jsonc"),
        JSON.stringify({
          linter: { enabled: true, rules: { preset: "none" } },
        }),
      );

      for (const [name, source] of suppressionFixtures) {
        const appDir = join(fixture, "apps", name);
        mkdirSync(join(appDir, "src"), { recursive: true });
        writeFileSync(join(appDir, "src/bypass.tsx"), source);
        writeFileSync(join(appDir, "effect-baseline.json"), "{}\n");
        writeFileSync(
          join(appDir, "biome.json"),
          JSON.stringify({
            root: false,
            extends: "//",
            overrides: [
              {
                includes: COMMON_BASE_INCLUDES,
                plugins: [PLUGIN_REL_FROM_APP],
              },
            ],
          }),
        );

        // First prove Biome itself actually silenced the plugin diagnostic,
        // so we know each fixture exercises a real Biome suppression form.
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

        // Now verify the baseline checker rejects the suppression end-to-end.
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
      overrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /non-baselined file/);
  });

  test("fails on a baselined file whose count grows", () => {
    const errors = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 3]]),
      baseline: { "src/existing.tsx": 2 },
      overrideIncludes: [...baseIncludes, "!src/existing.tsx"],
      baseIncludes,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /grew from 2 to 3/);
  });

  test("fails on a zero-count entry left in the baseline", () => {
    const explicitZero = findBaselineViolations({
      actualCounts: new Map(),
      baseline: { "src/migrated.tsx": 0 },
      overrideIncludes: [...baseIncludes, "!src/migrated.tsx"],
      baseIncludes,
    });
    assert.equal(explicitZero.length, 1);
    assert.match(explicitZero[0], /positive integer/);

    const staleEntry = findBaselineViolations({
      actualCounts: new Map(),
      baseline: { "src/migrated.tsx": 1 },
      overrideIncludes: [...baseIncludes, "!src/migrated.tsx"],
      baseIncludes,
    });
    assert.equal(staleEntry.length, 1);
    assert.match(staleEntry[0], /has 0 direct effects/);
  });

  test("fails when a baselined file shrinks without lowering the baseline", () => {
    const errors = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 1]]),
      baseline: { "src/existing.tsx": 2 },
      overrideIncludes: [...baseIncludes, "!src/existing.tsx"],
      baseIncludes,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /dropped from 2 to 1/);
  });

  test("fails when biome.json override drifts from effect-baseline.json", () => {
    const errors = findBaselineViolations({
      actualCounts: new Map([["src/existing.tsx", 1]]),
      baseline: { "src/existing.tsx": 1 },
      overrideIncludes: [...baseIncludes],
      baseIncludes,
    });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /override includes do not match/);
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

  test("allows unrelated suppressions and prose while rejecting all effect-rule suppressions", () => {
    const findings = findEffectSuppressionsInFiles(
      new Map([
        [
          "src/mixed.tsx",
          [
            "// biome-ignore lint: bypass",
            "// biome-ignore lint/plugin: bypass",
            "// biome-ignore lint/plugin/no-direct-effects: bypass",
            "// biome-ignore plugin: bypass",
            "// biome-ignore-all lint/plugin/no-direct-effects: bypass",
            "// biome-ignore-start lint/plugin/no-direct-effects: bypass",
            "/* biome-ignore lint/correctness/noUnusedVariables lint/plugin/no-direct-effects: bypass */",
            "// biome-ignore lint/correctness/noUnusedVariables: unrelated",
            "// biome-ignore lint/plugin/named-clock-formats: unrelated plugin",
            "// `biome-ignore` in prose is fine",
          ].join("\n"),
        ],
      ]),
    );
    assert.equal(findings.length, 7);
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

      // Valid commit predating the baseline file -> null bootstrap.
      assert.equal(
        readBaseBaseline(preBaselineSha, "web", { cwd: repo, env }),
        null,
      );

      // Bogus / missing ref -> must throw instead of silently skipping.
      assert.throws(
        () =>
          readBaseBaseline("refs/heads/does-not-exist", "web", {
            cwd: repo,
            env,
          }),
        /Invalid EFFECT_BASELINE_BASE_REF/,
      );

      // Valid commit with valid JSON -> returns parsed object.
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

      // Valid commit with invalid JSON -> must throw.
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
    test(`apps/${app.name} matches its effect-baseline.json with no suppressions`, () => {
      const { baseline, suppressions, violations } = checkAppDir(app);

      assert.deepEqual(
        suppressions,
        [],
        `apps/${app.name} has forbidden biome-ignore suppression(s) for the effect rule:\n${suppressions.join("\n")}`,
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
});
