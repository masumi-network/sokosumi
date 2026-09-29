import { describe, expect, it } from "vitest";

import {
  STUDIO_COLUMN_FEED_HEIGHT_CLASS,
  STUDIO_COLUMN_MOBILE_SHELL_CLASS,
} from "./studio-classes";

describe("studio column height", () => {
  it("pins the mobile column under the header with no tab-bar offset", () => {
    expect(STUDIO_COLUMN_MOBILE_SHELL_CLASS).toContain(
      "max-md:h-[calc(100dvh-4rem-env(safe-area-inset-top))]",
    );
    expect(STUDIO_COLUMN_MOBILE_SHELL_CLASS).not.toContain("max-md:h-full");
  });

  it("keeps the desktop column below the in-flow header and page pad", () => {
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain(
      "md:h-[calc(100dvh-6rem-env(safe-area-inset-top))]",
    );
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain(
      "env(safe-area-inset-top)",
    );
  });
});
