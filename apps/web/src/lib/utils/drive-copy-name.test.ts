import { describe, expect, it } from "vitest";

import { copyName } from "./drive-copy-name";

describe("copyName", () => {
  it("adds the label before the extension, numbered after the first try", () => {
    expect(copyName("weekly.md", "copy", 1)).toBe("weekly (copy).md");
    expect(copyName("weekly.md", "copy", 2)).toBe("weekly (copy) 2.md");
    expect(copyName("README", "copy", 1)).toBe("README (copy)");
  });

  it("trims a long stem, never the label, number or extension", () => {
    const name = copyName(`${"a".repeat(252)}.md`, "copy", 2);
    expect(name).toBe(`${"a".repeat(243)} (copy) 2.md`);
    expect(name).toHaveLength(255);
  });

  it("gives each numbered try of a 255-character name its own name", () => {
    expect(copyName("b".repeat(255), "copy", 1)).toBe(
      `${"b".repeat(248)} (copy)`,
    );
    expect(copyName("b".repeat(255), "copy", 2)).toBe(
      `${"b".repeat(246)} (copy) 2`,
    );
  });

  it("never splits an emoji at the trim boundary", () => {
    const name = copyName(`${"c".repeat(247)}😀.md`, "copy", 1);
    expect(name).toBe(`${"c".repeat(245)} (copy).md`);
    expect(name.isWellFormed()).toBe(true);
  });
});
