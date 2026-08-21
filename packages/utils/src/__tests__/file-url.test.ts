import { describe, expect, it } from "vitest";
import { isFileLikeUrl } from "../file-url.js";

describe("isFileLikeUrl", () => {
  it("recognizes URLs with file extensions", () => {
    expect(isFileLikeUrl("https://example.com/file.pdf")).toBe(true);
    expect(isFileLikeUrl("https://example.com/doc.docx")).toBe(true);
    expect(isFileLikeUrl("https://example.com/presentation.pptx")).toBe(true);
    expect(isFileLikeUrl("https://example.com/image.png")).toBe(true);
  });

  it("recognizes /deliverables/ URLs without extensions", () => {
    expect(
      isFileLikeUrl("https://elena.sokosumi.com/deliverables/01a019d9"),
    ).toBe(true);
    expect(
      isFileLikeUrl(
        "https://coworker.example.com/deliverables/abc-123-def-456",
      ),
    ).toBe(true);
  });

  it("recognizes /deliverables/ URLs with extensions", () => {
    expect(
      isFileLikeUrl(
        "https://elena.sokosumi.com/deliverables/begin-token2049-booth.pptx",
      ),
    ).toBe(true);
  });

  it("rejects non-http URLs", () => {
    expect(isFileLikeUrl("ftp://example.com/file.pdf")).toBe(false);
    expect(isFileLikeUrl("file:///path/to/file.pdf")).toBe(false);
  });

  it("rejects URLs with hash fragments", () => {
    expect(isFileLikeUrl("https://example.com/file.pdf#page=2")).toBe(false);
  });

  it("rejects URLs without file extensions or /deliverables/ path", () => {
    expect(isFileLikeUrl("https://example.com/page")).toBe(false);
    expect(isFileLikeUrl("https://example.com/api/data")).toBe(false);
  });

  it("rejects URLs with unsupported extensions", () => {
    expect(isFileLikeUrl("https://example.com/script.exe")).toBe(false);
    expect(isFileLikeUrl("https://example.com/file.xyz")).toBe(false);
  });
});
