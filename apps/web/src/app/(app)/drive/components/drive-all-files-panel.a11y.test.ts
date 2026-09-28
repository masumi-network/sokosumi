import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The panel does not read an organisation id aloud.
 *
 * It rendered `storeKey` — `${scope}:${organizationId}` — into a span with
 * `className="sr-only"`. That class hides an element from sight and not
 * from assistive technology, so a screen reader announced the
 * organisation id as part of the All files panel while a sighted reader
 * saw nothing. It carried a `data-testid` and nothing in the repository
 * ever referenced it: a test hook that shipped without its test.
 *
 * Asserted against the source rather than a render, because the panel
 * imports enough of the app that the test worker aborts before it
 * mounts — measured twice, SIGABRT after about 200 seconds. The claim is
 * about what the component renders at all, so reading the file is a
 * faithful way to ask it.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL("./drive-all-files-panel.tsx", import.meta.url)),
  "utf8",
);

/** JSX bodies only, so prose about the defect does not count as the defect. */
function jsxLines(): { line: number; text: string }[] {
  return SOURCE.split("\n")
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text }) => !/^\s*(\*|\/\/|\/\*)/.test(text));
}

describe("what the All files panel exposes to assistive technology", () => {
  it("renders no sr-only element", () => {
    const offenders = jsxLines().filter(({ text }) =>
      /className=("|'|{`)?[^"'`]*\bsr-only\b/.test(text),
    );

    expect(
      offenders.map((entry) => `${entry.line}:${entry.text.trim()}`),
      "sr-only hides an element from sight and not from a screen reader, " +
        "so anything put there is read aloud — add it here only if a " +
        "reader is meant to hear it",
    ).toEqual([]);
  });

  it("never renders the store key", () => {
    // The specific value: scope plus organisation id, which is an internal
    // identifier and not something a reader of a file list needs.
    const offenders = jsxLines().filter(({ text }) =>
      /\{\s*storeKey\s*\}/.test(text),
    );

    expect(
      offenders.map((entry) => `${entry.line}:${entry.text.trim()}`),
      "storeKey is an effect dependency, not content",
    ).toEqual([]);
  });

  it("is still watching a panel that exists", () => {
    // A guard that reads the wrong file passes by finding nothing.
    expect(SOURCE).toContain("export function DriveAllFilesPanel");
    expect(SOURCE).toContain("const storeKey =");
  });
});
