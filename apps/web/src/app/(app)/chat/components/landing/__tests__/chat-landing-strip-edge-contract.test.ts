import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Coworker strip on Welcome (`/`) landing must span the full content column
 * (edge-to-edge). Horizontal page padding on an overflow-y ancestor clips
 * edge avatars — CSS promotes overflow-x to auto when overflow-y is not
 * visible — so pitch/stats/selected get `px-*`, not the strip column.
 *
 * Mobile also sits under authenticated-app-frame `main` `p-4` (+ overflow-x
 * hidden). The md:hidden landing shell must cancel that pad (`-m-4`, same
 * pattern as `/chat` + room shell) or the strip scrollport stays
 * 16→344 on a 375 viewport.
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

  it("desktop landing cancels app-main p-4 and does not cap strip width", () => {
    const source = readFileSync(
      join(import.meta.dirname, "..", "chat-landing.tsx"),
      "utf8",
    );

    expect(source).toMatch(/-mx-4/);
    expect(source).not.toMatch(/max-w-6xl/);
    expect(source).not.toMatch(/overflow-y-auto[^\n]*max-w-/);
  });

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

  it("app main still pads with p-4 (the ancestor that would clip mobile)", () => {
    const source = readFileSync(
      join(
        import.meta.dirname,
        "../../../../components/authenticated-app-frame.tsx",
      ),
      "utf8",
    );

    expect(source).toContain("data-app-main");
    // Load-bearing: mobile landing -m-4 cancels this. If pad moves, update
    // (welcome)/page.tsx mobile shell in the same change. className with p-4 is
    // declared before the data-app-main attribute on <main>.
    expect(source).toMatch(
      /<main[\s\S]*?\bp-4\b[\s\S]*?data-app-main[\s\S]*?>/,
    );
    expect(source).toMatch(/overflow-x-hidden/);
  });

  it("mobile Welcome landing shell cancels app-main p-4 so the strip can hit the viewport edge", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../../../../(welcome)/page.tsx"),
      "utf8",
    );

    // Drop block comments so docs mentioning class names do not false-positive.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "");

    expect(code).toContain("ChatLandingMobile");
    // Same cancel as /chat + room shell. Bare w-full without -m-4 leaves
    // scrollport at 16→344 under main p-4.
    expect(code).toMatch(/-m-4[^"'\n]*md:hidden|md:hidden[^"'\n]*-m-4/);
    expect(code).toMatch(
      /className="[^"]*-m-4[^"]*md:hidden[^"]*"|className="[^"]*md:hidden[^"]*-m-4[^"]*"/,
    );

    // Desktop landing must not pick up the mobile cancel (md:flex stays separate).
    expect(code).toMatch(/hidden[^"'\n]*md:flex/);
    expect(code).toContain("ChatLanding");
  });
});
