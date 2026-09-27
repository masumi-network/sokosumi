import { describe, expect, it } from "vitest";
import { assertDocxImageCount } from "@/lib/utils/docx-export-budget";

describe("assertDocxImageCount", () => {
  it("includes repeated references, inline images, SVG and header images", () => {
    const root = {
      type: "root",
      children: [
        ...Array.from({ length: 16 }, () => ({ type: "imageReference" })),
        { type: "paragraph", children: [{ type: "image" }, { type: "svg" }] },
      ],
    };
    expect(() => assertDocxImageCount(root, 2)).not.toThrow();
    expect(() => assertDocxImageCount(root, 3)).toThrow(
      "DOCX image count exceeds limit",
    );
  });
  it("counts raw HTML image and SVG tags before plugin conversion", () => {
    const root = {
      type: "root",
      children: [
        { type: "html", value: '<IMG src="a"><svg></svg>'.repeat(10) },
      ],
    };
    expect(() => assertDocxImageCount(root, 0)).not.toThrow();
    expect(() => assertDocxImageCount(root, 1)).toThrow(
      "DOCX image count exceeds limit",
    );
  });
  it("does not count definitions or code examples as image occurrences", () => {
    const root = {
      type: "root",
      children: [
        { type: "definition" },
        { type: "code", value: "<img>".repeat(21) },
      ],
    };
    expect(() => assertDocxImageCount(root, 0)).not.toThrow();
  });
});
