import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getNotificationViewPreference,
  NOTIFICATION_VIEW_STORAGE_KEY,
  setNotificationViewPreference,
} from "./notification-view-storage";

describe("notification-view-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("exposes the storage key constant", () => {
    expect(NOTIFICATION_VIEW_STORAGE_KEY).toBe(
      "sokosumi:notification-center-view:v1",
    );
  });

  it("roundtrips every view", () => {
    for (const view of ["all", "unread", "needs-action"] as const) {
      setNotificationViewPreference(view);
      expect(getNotificationViewPreference()).toBe(view);
      expect(window.localStorage.getItem(NOTIFICATION_VIEW_STORAGE_KEY)).toBe(
        view,
      );
    }
  });

  it("returns null when the key is missing", () => {
    expect(getNotificationViewPreference()).toBeNull();
  });

  it("drops a value it does not recognise", () => {
    window.localStorage.setItem(NOTIFICATION_VIEW_STORAGE_KEY, "needsAction");

    expect(getNotificationViewPreference()).toBeNull();
    expect(
      window.localStorage.getItem(NOTIFICATION_VIEW_STORAGE_KEY),
    ).toBeNull();
  });

  it("soft-fails when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getNotificationViewPreference()).toBeNull();

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => setNotificationViewPreference("unread")).not.toThrow();
  });
});
