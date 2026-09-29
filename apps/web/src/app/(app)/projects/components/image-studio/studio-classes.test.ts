import { describe, expect, it } from "vitest";

import { STUDIO_COLUMN_FEED_HEIGHT_CLASS } from "./studio-classes";

describe("STUDIO_COLUMN_FEED_HEIGHT_CLASS", () => {
  it("fills leftover chrome instead of subtracting a desktop-only header band from 100dvh", () => {
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain("flex-1");
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain("min-h-0");
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).not.toContain("100dvh");
  });
});
