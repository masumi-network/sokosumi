import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

// The Apple emoji picker's catalogue lists every emoji.
const EMOJI_CATALOGUE =
  "apps/apple/Packages/SokosumiChat/Sources/SokosumiChat/Resources/Emoji/";

// This file names the icons it bans.
const SELF = "scripts/ci/__tests__/no-sparkles.test.mjs";

const SPARKLES_EMOJI = String.fromCodePoint(0x2728);

// Lucide and Phosphor names (`Sparkles`, `WandSparkles`, `SparkleIcon`,
// `Wand2`, `MagicWand`) and their kebab-case icon ids. Lowercase "sparkle"
// alone stays allowed: it is a Soko Bot avatar eye style, not an icon.
const SCRIPT_ICON =
  /\b\w*Sparkles?\w*\b|\b(?:Magic)?Wand\d?(?:Icon)?\b|["'`/](?:wand-)?sparkles["'`]/;

// SF Symbols. `import Sparkle` (the macOS updater framework) is not a symbol
// name in quotes, so it never matches.
const SWIFT_ICON = /"(?:sparkles?|wand\.and\.(?:sparkles|stars|rays))[\w.]*"/;

const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/;

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

function findings() {
  const found = [];
  for (const file of trackedFiles()) {
    if (file === SELF || file.startsWith(EMOJI_CATALOGUE)) continue;
    let text;
    try {
      text = readFileSync(join(ROOT, file), "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0")) continue;
    const icon = SCRIPT_FILE.test(file)
      ? SCRIPT_ICON
      : file.endsWith(".swift")
        ? SWIFT_ICON
        : null;
    text.split("\n").forEach((line, index) => {
      if (line.includes(SPARKLES_EMOJI)) {
        found.push(`${file}:${index + 1} sparkles emoji`);
      }
      const match = icon?.exec(line);
      if (match) {
        found.push(`${file}:${index + 1} sparkle icon ${match[0]}`);
      }
    });
  }
  return found;
}

test("the repo has no sparkles emoji and no sparkle icon", () => {
  assert.deepEqual(
    findings(),
    [],
    "Use a plain icon that says what the thing is, or none (root AGENTS.md).",
  );
});
