import { describe, expect, it } from "vitest";

import {
  isSocialProviderEnabled,
  SOCIAL_ENABLED_PROVIDERS,
  socialProviderUnavailableMessage,
} from "./social-post.js";

describe("Social provider availability", () => {
  it("enables only X with one shared switch", () => {
    expect(SOCIAL_ENABLED_PROVIDERS).toEqual(["x"]);
    expect(isSocialProviderEnabled("x")).toBe(true);
    expect(socialProviderUnavailableMessage("x")).toBeNull();
  });

  it.each([
    ["tiktok", "TikTok"],
    ["instagram", "Instagram"],
    ["linkedin", "LinkedIn"],
    ["facebook", "Facebook"],
    ["youtube", "YouTube"],
  ] as const)("keeps %s unavailable with a clear reason", (provider, label) => {
    expect(isSocialProviderEnabled(provider)).toBe(false);
    expect(socialProviderUnavailableMessage(provider)).toBe(
      `${label} is coming soon. Only X is available right now.`,
    );
  });

  it.each(["threads", "", "X", "toString", "__proto__"])(
    "does not enable an unknown provider: %s",
    (provider) => {
      expect(isSocialProviderEnabled(provider)).toBe(false);
    },
  );
});
