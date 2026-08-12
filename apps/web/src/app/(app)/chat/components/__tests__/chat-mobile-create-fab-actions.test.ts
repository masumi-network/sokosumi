import { describe, expect, it } from "vitest";

import {
  CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM,
  CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM_APPLE,
  chatMobileCreateFabScrimBottom,
} from "../chat-mobile-create-fab-actions";

describe("chatMobileCreateFabScrimBottom", () => {
  it("uses docked and Apple scrim bottoms above the tab bar", () => {
    expect(chatMobileCreateFabScrimBottom(false)).toBe(
      CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM,
    );
    expect(chatMobileCreateFabScrimBottom(true)).toBe(
      CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM_APPLE,
    );
    expect(CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM).toContain("4rem");
    expect(CHAT_MOBILE_CREATE_FAB_SCRIM_BOTTOM_APPLE).toContain("max(0.75rem");
  });
});
