import { describe, expect, it } from "vitest";

import { getFileNameFromUrl } from "./url";

describe("getFileNameFromUrl", () => {
  it("returns the last pathname segment for a valid URL", () => {
    expect(getFileNameFromUrl("https://example.com/path/to/report.pdf")).toBe(
      "report.pdf",
    );
  });

  it("returns empty string when the path ends with a slash", () => {
    expect(getFileNameFromUrl("https://example.com/foo/")).toBe("");
  });

  it("falls back to splitting the string when URL parsing fails", () => {
    expect(getFileNameFromUrl("not-a-url/but/filename.txt")).toBe(
      "filename.txt",
    );
  });
});
