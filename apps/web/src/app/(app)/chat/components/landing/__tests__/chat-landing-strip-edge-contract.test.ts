import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Coworker strip on `/chat` landing must span the full content column
 * (edge-to-edge). Horizontal page padding on an overflow-y ancestor clips
 * edge avatars — CSS promotes overflow-x to auto when overflow-y is not
 * visible — so pitch/stats/selected get `px-*`, not the strip column.
 */
describe("chat landing coworker strip edge-to-edge contract", () => {
  it.each(["chat-landing.tsx", "chat-landing.mobile.tsx"])(
    "%s keeps horizontal pad off the overflow-y column that hosts the strip",
    (filename) => {
      const source = readFileSync(
        join(import.meta.dirname, "..", filename),
        "utf8",
      );

      // The scrollable middle column must not carry px-* (that insets + clips
      // the strip). Greeting/intro may pad themselves; strip stays full width.
      expect(source).toMatch(/overflow-y-auto/);
      expect(source).not.toMatch(/overflow-y-auto[^\n]*px-\d/);
      expect(source).not.toMatch(/px-\d[^\n]*overflow-y-auto/);

      // Landing still pads non-strip surfaces so text/stats aren't flush.
      expect(source).toMatch(/px-4/);
      expect(source).toContain("LandingCoworkerPicker");
    },
  );

  it("mobile section itself is not the horizontal pad wrapper", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "chat-landing.mobile.tsx"),
      "utf8",
    );

    // Section used to be `… items-stretch px-4 pt-4 …` which inset the strip.
    expect(source).not.toMatch(/items-stretch px-\d/);
    expect(source).toMatch(/items-stretch pt-4/);
  });

  it("picker keeps the strip full-bleed and pads only the selected block", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "landing-coworker-picker.client.tsx"),
      "utf8",
    );

    expect(source).toContain('data-testid="landing-coworker-strip"');
    expect(source).toContain('data-testid="landing-selected-block"');

    // Selected block (name → CTA) stays inset; strip wrapper must not.
    const stripBlock = source.slice(
      source.indexOf('data-testid="landing-coworker-strip"') - 200,
      source.indexOf('data-testid="landing-coworker-strip"') + 80,
    );
    expect(stripBlock).not.toMatch(/px-\d/);
    expect(stripBlock).toMatch(/w-full/);
    expect(stripBlock).toMatch(/max-w-full/);

    const selectedBlock = source.slice(
      source.indexOf('data-testid="landing-selected-block"') - 280,
      source.indexOf('data-testid="landing-selected-block"') + 80,
    );
    expect(selectedBlock).toMatch(/max-w-xs/);
    expect(selectedBlock).toMatch(/px-4/);
  });
});
