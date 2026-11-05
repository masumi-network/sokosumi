import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FORMAT_TOOLBAR_OPEN_STORAGE_KEY,
  getFormatToolbarOpenPreference,
  setFormatToolbarOpenPreference,
} from "./format-toolbar-preference-storage";

describe("format-toolbar-preference-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("exposes the storage key constant", () => {
    expect(FORMAT_TOOLBAR_OPEN_STORAGE_KEY).toBe(
      "sokosumi:format-toolbar-open:v1",
    );
  });

  it("roundtrips true and false", () => {
    setFormatToolbarOpenPreference(true);
    expect(getFormatToolbarOpenPreference()).toBe(true);
    expect(window.localStorage.getItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY)).toBe(
      "true",
    );

    setFormatToolbarOpenPreference(false);
    expect(getFormatToolbarOpenPreference()).toBe(false);
    expect(window.localStorage.getItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY)).toBe(
      "false",
    );
  });

  it("returns null when the key is missing", () => {
    expect(getFormatToolbarOpenPreference()).toBeNull();
  });

  it("returns null for invalid stored strings", () => {
    window.localStorage.setItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, "TRUE");
    expect(getFormatToolbarOpenPreference()).toBeNull();

    window.localStorage.setItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, "1");
    expect(getFormatToolbarOpenPreference()).toBeNull();

    window.localStorage.setItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, "");
    expect(getFormatToolbarOpenPreference()).toBeNull();
  });

  it("soft-fails when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getFormatToolbarOpenPreference()).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setFormatToolbarOpenPreference(true)).not.toThrow();
  });
});
