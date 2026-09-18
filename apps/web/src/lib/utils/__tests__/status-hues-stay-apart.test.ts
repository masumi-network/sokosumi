import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function read(rel: string): string {
  return readFileSync(path.join(SRC_ROOT, rel), "utf8");
}

/**
 * Two colours within 15 degrees of hue read as one colour, so two roles that
 * close together cannot mean two different things. That is what broke when
 * the brand moved from hue 263.5 to 201.8: `--status-working` at 205 landed
 * 3.2 degrees from `--primary`, and the retired `--semantic-info` at 193
 * landed 8.8 away. Three roles, one colour.
 *
 * This pins the separation rather than the hue. Move either role and the
 * test says so; move one far enough and it passes, whatever value you pick.
 */
const MIN_HUE_SEPARATION_DEGREES = 15;

/** Shortest way round the wheel: 350 and 10 are 20 apart, not 340. */
function hueGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % 360;
  return raw > 180 ? 360 - raw : raw;
}

function hueOf(css: string, block: RegExp, token: string): number {
  const scope = css.match(block);
  if (!scope) throw new Error(`theme block not found for ${token}`);
  const found = scope[0].match(
    new RegExp(`--${token}:\\s*hsla?\\(\\s*([0-9.]+)`),
  );
  if (!found?.[1]) throw new Error(`--${token} not found in its theme block`);
  return Number(found[1]);
}

const LIGHT = /:root\s*\{[\s\S]*?\n\}/;
const DARK = /\.dark\s*\{[\s\S]*?\n\}/;

describe("status hues stay apart", () => {
  const css = read("app/globals.css");

  for (const [theme, block] of [
    ["light", LIGHT],
    ["dark", DARK],
  ] as const) {
    it(`keeps the working role off the brand hue in ${theme}`, () => {
      const gap = hueGap(
        hueOf(css, block, "status-working"),
        hueOf(css, block, "primary"),
      );
      expect(gap).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION_DEGREES);
    });

    it(`keeps the working and external roles apart in ${theme}`, () => {
      const gap = hueGap(
        hueOf(css, block, "status-working"),
        hueOf(css, block, "status-external"),
      );
      expect(gap).toBeGreaterThanOrEqual(MIN_HUE_SEPARATION_DEGREES);
    });
  }

  it("keeps the retired info ramp retired", () => {
    // Every consumer of --semantic-info meant "in flight", never
    // "information". Reintroducing it recreates the duplicate role.
    expect(css).not.toMatch(/--semantic-info(-[a-z]+)?:/);
    expect(css).not.toContain("--color-semantic-info");
  });

  it("paints the Soko Bot badge on -quaternary, not -quinary", () => {
    // The quinary steps sit at 93 to 95 percent lightness, where every pair
    // of the six tones measured under OKLab dE 6.0.
    const badge = read("components/soko-bot/status-badge.tsx");
    const tones = badge.slice(
      badge.indexOf("const TONE_CLASSES"),
      badge.indexOf("const DOT_CLASSES"),
    );
    expect(tones).not.toMatch(/bg-[a-z-]*-quinary/);
  });
});
