import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const DIRECT_PLUGIN_REL_FROM_APP =
  "../../biome-plugins/no-direct-effects.grit";
export const ALIAS_PLUGIN_REL_FROM_APP =
  "../../biome-plugins/no-effect-aliases.grit";
export const GENERATED_BIOME_FILENAME = ".effect-baseline.biome.json";
export const GENERATED_BIOME_EXTEND_PATH = `./${GENERATED_BIOME_FILENAME}`;
export const ROOT_BIOME_EXTEND_PATH = "../../biome.jsonc";

export const COMMON_BASE_INCLUDES = [
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

export const EFFECT_APPS = [
  {
    name: "web",
    relDir: "apps/web",
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
    relDir: "apps/cmo",
    baseIncludes: [...COMMON_BASE_INCLUDES],
    exemptUi: false,
  },
];

export function escapeBiomeGlob(relPath) {
  return relPath.replace(/[\\[\]]/g, "\\$&");
}

export function sortBaselineKeys(keys) {
  return [...keys].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function formatEffectBaseline(baseline) {
  const sorted = {};
  for (const key of sortBaselineKeys(Object.keys(baseline))) {
    sorted[key] = baseline[key];
  }
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function buildDirectEffectIncludes(baseIncludes, baseline) {
  const exemptFiles = sortBaselineKeys(
    Object.entries(baseline)
      .filter(([, count]) => Number.isInteger(count) && count > 0)
      .map(([file]) => file),
  );
  return [
    ...baseIncludes,
    ...exemptFiles.map((file) => `!${escapeBiomeGlob(file)}`),
  ];
}

export function buildGeneratedBiomeConfig(app, baseline) {
  return {
    overrides: [
      {
        includes: buildDirectEffectIncludes(app.baseIncludes, baseline),
        plugins: [DIRECT_PLUGIN_REL_FROM_APP],
      },
    ],
  };
}

export function syncAppEffectBaseline(app, { rootDir = ROOT } = {}) {
  const appDir = join(rootDir, app.relDir);
  const baselinePath = join(appDir, "effect-baseline.json");
  const raw = readFileSync(baselinePath, "utf8");
  const baseline = JSON.parse(raw);
  if (!baseline || typeof baseline !== "object" || Array.isArray(baseline)) {
    throw new Error(`${baselinePath} must be a JSON object`);
  }

  const outPath = join(appDir, GENERATED_BIOME_FILENAME);
  const content = `${JSON.stringify(buildGeneratedBiomeConfig(app, baseline), null, 2)}\n`;
  if (existsSync(outPath) && readFileSync(outPath, "utf8") === content) {
    return { path: outPath, changed: false };
  }
  writeFileSync(outPath, content, "utf8");
  return { path: outPath, changed: true };
}

export function syncAllEffectBaselines({ rootDir = ROOT } = {}) {
  return EFFECT_APPS.map((app) => syncAppEffectBaseline(app, { rootDir }));
}

function isDirectRun() {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) ===
      realpathSync(resolve(process.argv[1]))
    );
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  syncAllEffectBaselines();
}
