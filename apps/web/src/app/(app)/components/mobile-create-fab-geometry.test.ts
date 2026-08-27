import { describe, expect, it } from "vitest";

import {
  LIST_MOBILE_CREATE_FAB_CLEARANCE,
  MOBILE_CREATE_FAB_BOTTOM,
  MOBILE_CREATE_FAB_BOTTOM_APPLE,
  mobileCreateFabBottom,
} from "./mobile-create-fab-geometry";

describe("mobileCreateFabBottom", () => {
  it("uses docked and Apple bottom offsets above the tab bar", () => {
    expect(mobileCreateFabBottom(false)).toBe(MOBILE_CREATE_FAB_BOTTOM);
    expect(mobileCreateFabBottom(true)).toBe(MOBILE_CREATE_FAB_BOTTOM_APPLE);
    expect(MOBILE_CREATE_FAB_BOTTOM).toContain("4rem");
    expect(MOBILE_CREATE_FAB_BOTTOM_APPLE).toContain("max(0.75rem");
  });
});

describe("LIST_MOBILE_CREATE_FAB_CLEARANCE", () => {
  it("pads for size-14 FAB plus gap and clears padding at md+", () => {
    expect(LIST_MOBILE_CREATE_FAB_CLEARANCE).toBe(
      "pb-[calc(3.5rem+1rem)] md:pb-0",
    );
  });
});
