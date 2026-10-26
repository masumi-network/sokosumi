import { describe, expect, it } from "vitest";

import { SOCIAL_PROVIDERS } from "./social-providers";

describe("SOCIAL_PROVIDERS", () => {
  it("lists every project network and marks every provider except X as coming soon", () => {
    expect(SOCIAL_PROVIDERS.map((provider) => provider.id)).toEqual([
      "x",
      "tiktok",
      "instagram",
      "linkedin",
      "facebook",
      "youtube",
    ]);
    expect(
      SOCIAL_PROVIDERS.filter(
        (provider) => "comingSoon" in provider && provider.comingSoon,
      ).map((provider) => provider.id),
    ).toEqual(["tiktok", "instagram", "linkedin", "facebook", "youtube"]);
    expect(
      SOCIAL_PROVIDERS.filter(
        (provider) => !("comingSoon" in provider) || !provider.comingSoon,
      ).map((provider) => provider.id),
    ).toEqual(["x"]);
    expect(
      SOCIAL_PROVIDERS.every((provider) => typeof provider.Icon === "function"),
    ).toBe(true);
  });
});
