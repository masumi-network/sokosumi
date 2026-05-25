/**
 * Sync App.Hermes translations across locale catalogs:
 * 1. Start from en.json structure (source of truth)
 * 2. Overlay legacy translations from main branch
 * 3. Apply nested overrides from messages/hermes-translations/{locale}.json
 * 4. Remove deprecated Provisioning.step1–step4 keys
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, "../messages");
const overridesDir = path.join(messagesDir, "hermes-translations");

const LOCALES = ["de", "es", "fr", "it", "ja", "pt", "pt-BR", "zh-Hans"];

function deepMerge(base, overlay) {
  if (
    overlay === null ||
    typeof overlay !== "object" ||
    Array.isArray(overlay)
  ) {
    return overlay ?? base;
  }
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base?.[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function stripProvisioningSteps(provisioning) {
  if (!provisioning) return provisioning;
  const {
    step1: _s1,
    step2: _s2,
    step3: _s3,
    step4: _s4,
    ...rest
  } = provisioning;
  return rest;
}

function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else {
      out[path] = value;
    }
  }
  return out;
}

function readHermesOverrides(overridePath) {
  const overrides = JSON.parse(fs.readFileSync(overridePath, "utf8"));
  return overrides.App?.Hermes ?? overrides;
}

function applyHermesOverrides(tree, overrides) {
  const merged = deepMerge(tree, overrides);
  merged.Provisioning = stripProvisioningSteps(merged.Provisioning);
  return merged;
}

const en = JSON.parse(
  fs.readFileSync(path.join(messagesDir, "en.json"), "utf8"),
);
const enHermes = en.App.Hermes;

for (const locale of LOCALES) {
  const localePath = path.join(messagesDir, `${locale}.json`);
  const localeData = JSON.parse(fs.readFileSync(localePath, "utf8"));

  let legacyHermes = {};
  try {
    const mainJson = execSync(
      `git show main:apps/web/messages/${locale}.json`,
      {
        encoding: "utf8",
        cwd: path.join(__dirname, "../.."),
      },
    );
    legacyHermes = stripProvisioningSteps(
      JSON.parse(mainJson).App?.Hermes ?? {},
    );
  } catch {
    // main branch may lack Hermes for some locales
  }

  const overridePath = path.join(overridesDir, `${locale}.json`);
  const hermesOverrides = readHermesOverrides(overridePath);

  const hermes = applyHermesOverrides(
    deepMerge(JSON.parse(JSON.stringify(enHermes)), legacyHermes),
    hermesOverrides,
  );

  localeData.App.Hermes = hermes;
  fs.writeFileSync(localePath, `${JSON.stringify(localeData, null, 2)}\n`);

  const enFlat = flatten(enHermes);
  const outFlat = flatten(hermes);
  const stillEnglish = Object.keys(enFlat).filter(
    (key) => JSON.stringify(outFlat[key]) === JSON.stringify(enFlat[key]),
  );
  console.log(
    `${locale}: ${stillEnglish.length} keys still match en (${Object.keys(enFlat).length} total)`,
  );
}
