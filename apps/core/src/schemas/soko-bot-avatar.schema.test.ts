import { describe, expect, it } from "vitest";

import {
  listSokoBotAvatarsQuerySchema,
  topUpSokoBotAvatarsRequestSchema,
} from "./soko-bot-avatar.schema";

describe("soko bot avatar list and top-up schemas", () => {
  it("ignores a topUp query parameter on the read", () => {
    // Generation bills FAL and writes rows. As a GET it was reachable by a
    // cross-site top-level navigation, which carries the session cookie under
    // SameSite=Lax, and was cacheable by intermediaries.
    const parsed = listSokoBotAvatarsQuerySchema.parse({
      take: "6",
      topUp: "true",
    });

    expect(parsed).not.toHaveProperty("topUp");
  });

  it("takes the top-up request as a body instead", () => {
    const parsed = topUpSokoBotAvatarsRequestSchema.parse({ take: 6 });

    expect(parsed).toEqual({ take: 6, excludeIds: [] });
  });

  it("caps a top-up at one generation batch", () => {
    expect(() => topUpSokoBotAvatarsRequestSchema.parse({ take: 7 })).toThrow();
  });
});
