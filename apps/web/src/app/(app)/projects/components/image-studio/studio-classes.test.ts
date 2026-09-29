import { describe, expect, it } from "vitest";

import { STUDIO_COLUMN_FEED_HEIGHT_CLASS } from "./studio-classes";

describe("STUDIO_COLUMN_FEED_HEIGHT_CLASS", () => {
  it("fills leftover chrome on mobile instead of a desktop-only 100dvh subtract", () => {
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain("max-md:h-full");
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain(
      "env(safe-area-inset-top)",
    );
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).not.toBe(
      "h-[calc(100dvh-6rem)] min-h-[28rem]",
    );
  });
});
