import { describe, expect, it } from "vitest";

import { SOCIAL_PROVIDERS } from "./social-providers";

describe("SOCIAL_PROVIDERS", () => {
  it("lists every project network and marks only TikTok as coming soon", () => {
    expect(SOCIAL_PROVIDERS.map((provider) => provider.id)).toEqual([
      "x",
      "tiktok",
      "instagram",
      "linkedin",
      "facebook",
      "youtube",
    ]);
    expect(
      SOCIAL_PROVIDERS.find((provider) => provider.id === "tiktok"),
    ).toEqual(expect.objectContaining({ name: "TikTok", comingSoon: true }));
    expect(
      SOCIAL_PROVIDERS.filter((provider) => provider.id !== "tiktok").every(
        (provider) => !("comingSoon" in provider) || !provider.comingSoon,
      ),
    ).toBe(true);
    expect(
      SOCIAL_PROVIDERS.every((provider) => typeof provider.Icon === "function"),
    ).toBe(true);
  });
});
