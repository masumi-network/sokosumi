import { describe, expect, it } from "vitest";

import { SOCIAL_PROVIDERS } from "./social-providers";

describe("SOCIAL_PROVIDERS", () => {
  it("lists every project network independently of workspace availability", () => {
    expect(SOCIAL_PROVIDERS.map((provider) => provider.id)).toEqual([
      "x",
      "tiktok",
      "instagram",
      "linkedin",
      "facebook",
      "youtube",
    ]);
    expect(
      SOCIAL_PROVIDERS.every((provider) => typeof provider.Icon === "function"),
    ).toBe(true);
  });
});
