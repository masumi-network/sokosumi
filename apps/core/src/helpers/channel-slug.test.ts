import { CHANNEL_SLUG_MAX_LENGTH } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { channelSlugWithId } from "./channel-slug";

const ID = "01960001-0001-7001-8001-000000000099";

describe("channelSlugWithId", () => {
  it("ends with the id and keeps a readable head", () => {
    expect(channelSlugWithId("Launch Team!", ID, "bot")).toBe(
      `launch-team-${ID}`,
    );
  });

  it("falls back when the name has nothing slug-safe", () => {
    expect(channelSlugWithId("!!!", ID, "bot")).toBe(`bot-${ID}`);
  });

  it("stays within the channel slug limit", () => {
    expect(
      channelSlugWithId("Ask ".repeat(40), ID, "ask").length,
    ).toBeLessThanOrEqual(CHANNEL_SLUG_MAX_LENGTH);
  });
});
