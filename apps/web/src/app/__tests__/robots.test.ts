import { describe, expect, it, vi } from "vitest";

// Pin Mainnet so a network-gated Allow: / cannot sneak back in.
vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => ({ NEXT_PUBLIC_NETWORK: "Mainnet" }),
}));

import robots from "../robots";

describe("web robots.txt", () => {
  it("disallows all crawlers, including on Mainnet", () => {
    expect(robots()).toEqual({
      rules: {
        userAgent: "*",
        disallow: "/",
      },
    });
  });
});
