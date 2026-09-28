import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The sheet and the detail route render the same component.
 *
 * The detail page is no longer the main way to see a file, but it stays as the
 * shareable deep link, and the temptation is to give the sheet its own copy of
 * that markup. A copy drifts: a fix to the coverage line, the no-text state or
 * the suggestion controls lands in one host and not the other, and nothing fails
 * — the two just quietly stop agreeing about the same document.
 *
 * Asserted against source, because this is a claim about *how* the two hosts are
 * built and not about what either renders. A rendering test cannot see a second
 * copy of the markup; it would pass happily against both.
 */

function read(relative: string): string {
  return readFileSync(
    fileURLToPath(new URL(relative, import.meta.url)),
    "utf8",
  );
}

const VIEW = read("./file-detail-view.tsx");
const SHEET = read("./drive-file-sheet.tsx");
const ROUTE = read("../files/[resourceId]/file-detail-client.tsx");

/** Markup only, so prose about a thing does not count as the thing. */
function jsxLines(source: string): string[] {
  return source.split("\n").filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line));
}

describe("one component, two hosts", () => {
  it("has both hosts render FileDetailView", () => {
    for (const [name, source] of [
      ["the sheet", SHEET],
      ["the route", ROUTE],
    ] as const) {
      expect(source, name).toContain(
        'from "@/app/drive/components/file-detail-view"',
      );
      expect(source, name).toContain("<FileDetailView");
    }
  });

  it("keeps the document's own markup in one place", () => {
    // These are the pieces the request named: the preview, the coverage line,
    // the no-text state, the suggestions panel and the label controls. Each must
    // appear in the view and in neither host.
    const owned = [
      "DriveFilePreview",
      "processingPartialCoverage",
      "relatedNoText",
      "detailSuggestions",
      "detailTags",
    ];

    for (const token of owned) {
      expect(VIEW, `${token} belongs to the shared view`).toContain(token);
    }

    for (const [name, source] of [
      ["the sheet", SHEET],
      ["the route", ROUTE],
    ] as const) {
      const lines = jsxLines(source);
      for (const token of owned) {
        expect(
          lines.filter((line) => line.includes(token)),
          `${token} is duplicated into ${name}; it drifts from the other host ` +
            "the first time one of them is fixed",
        ).toEqual([]);
      }
    }
  });

  it("is still watching a view that exists", () => {
    // A guard that reads the wrong file passes by finding nothing.
    expect(VIEW).toContain("export function FileDetailView");
  });

  it("keeps the detail route reachable from the sheet", () => {
    // A sheet has no URL of its own, so without this the deep link is only
    // reachable by knowing it exists.
    expect(SHEET).toContain("`/drive/files/${resourceId}`");
  });

  it("opens the sheet from a link, not a button", () => {
    const row = read("./drive-file-row.tsx");
    // An <a href> keeps copy-link, middle-click and cmd-click working and
    // announces a link to a document. A button would have been less code and
    // would have removed the ability to share a file.
    expect(row).toContain("href={`/drive/files/${item.id}`}");
    // And the modifier keys the reader pressed are honoured rather than eaten.
    for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      expect(row, `${key} must fall through to real navigation`).toContain(key);
    }
  });
});
