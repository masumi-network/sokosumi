import { afterEach, describe, expect, it, vi } from "vitest";

import {
  expireRetiredOnboardingLocalStorage,
  RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
} from "@/lib/retired-onboarding-storage";

describe("expireRetiredOnboardingLocalStorage", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("removes the retired subscription last-login key", () => {
    window.localStorage.setItem(
      RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
      "sess-1",
    );
    window.localStorage.setItem("sokosumi.locale", "en");

    expireRetiredOnboardingLocalStorage();

    expect(
      window.localStorage.getItem(
        RETIRED_SUBSCRIPTION_ONBOARDING_LOGIN_STORAGE_KEY,
      ),
    ).toBeNull();
    expect(window.localStorage.getItem("sokosumi.locale")).toBe("en");
  });

  it("does not throw when localStorage.removeItem is blocked", () => {
    const removeItem = vi
      .spyOn(Storage.prototype, "removeItem")
      .mockImplementation(() => {
        throw new Error("blocked");
      });

    try {
      expect(() => expireRetiredOnboardingLocalStorage()).not.toThrow();
    } finally {
      removeItem.mockRestore();
    }
  });
});
