import { describe, expect, it } from "vitest";

import { copyAttemptName } from "./drive-copy-name";

describe("copyAttemptName", () => {
  it("adds a random id after the readable copy label and keeps the extension", () => {
    expect(copyAttemptName("weekly (copy).md")).toMatch(
      /^weekly \(copy\) [0-9a-f]{10}\.md$/,
    );
    expect(copyAttemptName("README (copy)")).toMatch(
      /^README \(copy\) [0-9a-f]{10}$/,
    );
  });

  it("gives every attempt its own name", () => {
    const names = new Set(
      Array.from({ length: 1000 }, () => copyAttemptName("a (copy).md")),
    );
    expect(names.size).toBe(1000);
  });

  it("trims a long name before its label, by whole code points, keeping label, id and extension", () => {
    const name = copyAttemptName(`${"c".repeat(240)}😀 (copy).md`);
    expect(name.length).toBeLessThanOrEqual(255);
    expect(name).toMatch(/^c+ \(copy\) [0-9a-f]{10}\.md$/);
    expect(name.isWellFormed()).toBe(true);
  });
});
