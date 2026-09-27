import { describe, expect, it } from "vitest";

import { extractPdfText } from "./pdf";
import { buildPdfFixture } from "./pdf-fixture";

/**
 * A test for the test fixture, which needs a justification.
 *
 * The fixture is the input to every bound in `pdf.test.ts`. If it silently
 * drops most of the text it claims to carry, a page cap or a character cap
 * will pass without ever firing — the cap is never reached because the
 * content never arrived. That is not hypothetical: the first version of
 * this fixture put each page's text on one line, which ran off the right
 * edge of the media box, and a 400-character page came back as 35
 * characters. Both cap tests would have been green and meaningless.
 *
 * So the fixture makes a promise, and this is where the promise is checked.
 */

const TIMEOUT = 30_000;
const withoutWhitespace = (value: string) => value.replace(/\s/gu, "");

describe("the PDF fixture carries the text it is given", () => {
  /**
   * The promise, stated precisely: **every non-whitespace character
   * survives, in order.** Whitespace does not, and that is a property of
   * PDF rather than a defect here — the text is laid out as lines, and a
   * space that lands on a line boundary is not shown. Tests that care about
   * exact lengths use text without spaces.
   */
  it.each([
    ["the widest glyph in the standard font", "W".repeat(1_000)],
    ["a wide capital", "A".repeat(2_000)],
    ["punctuation", "@".repeat(800)],
    ["ordinary prose", "The quick brown fox. ".repeat(80)],
    ["many short words", "a b c d e f g ".repeat(60)],
  ])(
    "preserves every non-space character of %s",
    async (_label, text) => {
      const outcome = await extractPdfText(buildPdfFixture({ pages: [text] }));

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(withoutWhitespace(outcome.text)).toBe(withoutWhitespace(text));
    },
    TIMEOUT,
  );

  it(
    "hides the text from a byte-level read",
    async () => {
      /**
       * The property that makes an end-to-end proof mean anything.
       *
       * An uncompressed content stream leaves the page text in the file as
       * plain ASCII. A marker string could then reach a stored excerpt
       * without any PDF reader having run, and "the excerpt contains the
       * marker" would prove nothing about the parser — a check that passes
       * honestly while answering a question nobody asked.
       *
       * With FlateDecode the marker is not in the bytes, so downstream it
       * can only have come from a reader that decompressed and interpreted
       * the page.
       */
      const marker = "Zarbrinthquarterlyreconciliation";
      const bytes = buildPdfFixture({ pages: [marker] });

      // Not present as raw bytes, in any single-byte encoding.
      const asLatin1 = Buffer.from(bytes).toString("latin1");
      expect(asLatin1).not.toContain(marker);
      expect(Buffer.from(bytes).toString("utf8")).not.toContain(marker);
      // And the stream really is declared compressed.
      expect(asLatin1).toContain("/Filter /FlateDecode");

      // But a reader still gets it back.
      const outcome = await extractPdfText(bytes);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.text).toContain(marker);
    },
    TIMEOUT,
  );

  it(
    "keeps pages separate and in order",
    async () => {
      const outcome = await extractPdfText(
        buildPdfFixture({ pages: ["PAGEONE", "PAGETWO", "PAGETHREE"] }),
      );

      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.pages).toBe(3);
      const flat = withoutWhitespace(outcome.text);
      expect(flat).toBe("PAGEONEPAGETWOPAGETHREE");
    },
    TIMEOUT,
  );

  it(
    "produces a page with no text layer when asked for one",
    async () => {
      // The shape a scanned page has, and the input to the no-OCR decision.
      const outcome = await extractPdfText(buildPdfFixture({ pages: [""] }));

      expect(outcome).toEqual({ ok: false, failure: "no-text-layer" });
    },
    TIMEOUT,
  );
});
