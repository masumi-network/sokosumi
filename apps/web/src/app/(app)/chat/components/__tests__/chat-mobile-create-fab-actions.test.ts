import { describe, expect, it } from "vitest";

import {
  CHAT_MOBILE_CREATE_FAB_BOTTOM,
  CHAT_MOBILE_CREATE_FAB_BOTTOM_APPLE,
  CHAT_MOBILE_CREATE_FAB_CLEARANCE,
  chatMobileCreateFabBottom,
  chatMobileCreateFabScrimBottom,
  mobileCreateFabActions,
} from "../chat-mobile-create-fab-actions";

describe("mobileCreateFabActions", () => {
  it("returns chats actions with channel and dm only", () => {
    expect(mobileCreateFabActions("chats")).toEqual([
      { id: "createChannel", href: "/chat?create=channel" },
      { id: "newDm", href: "/chat?dm=new" },
    ]);
  });
});

describe("chatMobileCreateFabBottom", () => {
  it("uses docked and Apple bottom offsets above the tab bar", () => {
    expect(chatMobileCreateFabBottom(false)).toBe(
      CHAT_MOBILE_CREATE_FAB_BOTTOM,
    );
    expect(chatMobileCreateFabBottom(true)).toBe(
      CHAT_MOBILE_CREATE_FAB_BOTTOM_APPLE,
    );
    expect(chatMobileCreateFabScrimBottom(false)).toContain("4rem");
    expect(chatMobileCreateFabScrimBottom(true)).toContain("max(0.75rem");
  });
});

describe("CHAT_MOBILE_CREATE_FAB_CLEARANCE", () => {
  it("pads for size-14 FAB plus gap above the tab bar", () => {
    expect(CHAT_MOBILE_CREATE_FAB_CLEARANCE).toBe("pb-[calc(3.5rem+0.75rem)]");
  });
});
