import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  readStoredPreference,
  writeStoredPreference,
} from "./preference-storage";

const KEY = "sokosumi:test-preference:v1";

/** Anything the caller cannot name is not a preference. */
function parseSize(raw: string): "small" | "large" | null {
  return raw === "small" || raw === "large" ? raw : null;
}

describe("preference-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("reads back what was written", () => {
    writeStoredPreference(KEY, "large");

    expect(readStoredPreference(KEY, parseSize)).toBe("large");
  });

  it("returns null when nothing was written", () => {
    expect(readStoredPreference(KEY, parseSize)).toBeNull();
  });

  it("drops a value the caller cannot parse", () => {
    window.localStorage.setItem(KEY, "enormous");

    expect(readStoredPreference(KEY, parseSize)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("keeps a parsed value that is falsy", () => {
    window.localStorage.setItem(KEY, "false");

    expect(readStoredPreference(KEY, (raw) => raw === "true")).toBe(false);
    // Parsing succeeded, so the value stays for the next read.
    expect(window.localStorage.getItem(KEY)).toBe("false");
  });

  it("soft-fails when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readStoredPreference(KEY, parseSize)).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeStoredPreference(KEY, "small")).not.toThrow();
  });
});
