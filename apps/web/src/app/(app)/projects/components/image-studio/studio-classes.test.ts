import { describe, expect, it } from "vitest";

import {
  STUDIO_COLUMN_FEED_HEIGHT_CLASS,
  STUDIO_COLUMN_MOBILE_APPLE_HEIGHT_CLASS,
  STUDIO_COLUMN_MOBILE_SHELL_CLASS,
  STUDIO_COMPOSER_GUTTER_CLASS,
} from "./studio-classes";

describe("studio column height", () => {
  it("clears the header and docked mobile tab bar", () => {
    expect(STUDIO_COLUMN_MOBILE_SHELL_CLASS).toContain(
      "max-md:h-[calc(100dvh-8rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]",
    );
    expect(STUDIO_COLUMN_MOBILE_SHELL_CLASS).toContain("max-md:-m-4");
    expect(STUDIO_COLUMN_MOBILE_SHELL_CLASS).not.toContain("max-md:h-full");
  });

  it("clears the floating Apple mobile tab bar", () => {
    expect(STUDIO_COLUMN_MOBILE_APPLE_HEIGHT_CLASS).toContain(
      "max-md:h-[calc(100dvh-8rem-env(safe-area-inset-top)-max(0.75rem,env(safe-area-inset-bottom)))]",
    );
  });

  it("docks the desktop column like an open chat room", () => {
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain(
      "md:h-[calc(100dvh-4rem-env(safe-area-inset-top))]",
    );
    expect(STUDIO_COLUMN_FEED_HEIGHT_CLASS).toContain("md:-m-4");
  });

  it("uses the same composer gutter as chat", () => {
    expect(STUDIO_COMPOSER_GUTTER_CLASS).toBe("px-3 md:px-5");
  });
});
