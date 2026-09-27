import { describe, expect, it } from "vitest";

import { renderVerificationEmail } from "../index.js";
import { DARK_CLASS, LIGHT_PALETTE } from "../theme/index.js";

/**
 * Two of the shell's mechanisms rest on how react-email lays out a `Section`:
 * it puts `className` on the wrapper table and moves `style` padding to the
 * cell inside it. The narrow-width rule targets that cell, and the dark-mode
 * rules need the class to sit on the element carrying the light colour.
 *
 * Neither breaks the build when the library changes its output, and neither
 * shows up anywhere but an inbox. These pin the shape instead.
 */
describe("email shell markup", () => {
  it("pads the cell the narrow-width rule targets", async () => {
    const { html } = await renderVerificationEmail({
      locale: "en",
      name: "Andreas",
      verificationLink: "https://example.com/verify",
    });

    expect(html).toContain(".sk-pad > tbody > tr > td");
    // Header, content and footer: a wrapper table carrying the class, then a
    // cell carrying the padding the rule overrides.
    expect(
      html.match(/sk-pad"[^>]*><tbody><tr><td style="padding:/g),
    ).toHaveLength(3);
  });

  it("keeps the dark-mode class on the element holding the light colour", async () => {
    const { html } = await renderVerificationEmail({
      locale: "en",
      name: "Andreas",
      verificationLink: "https://example.com/verify",
    });

    expect(html).toMatch(
      new RegExp(
        `class="${DARK_CLASS.card}"[^>]*background-color:${LIGHT_PALETTE.surface}`,
      ),
    );
    expect(html).toMatch(
      new RegExp(
        `class="${DARK_CLASS.page}"[^>]*background-color:${LIGHT_PALETTE.pageBackground}`,
      ),
    );
  });
});
