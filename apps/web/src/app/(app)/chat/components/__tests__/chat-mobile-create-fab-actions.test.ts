import { describe, expect, it } from "vitest";

import {
  CHAT_MOBILE_CREATE_FAB_BOTTOM,
  CHAT_MOBILE_CREATE_FAB_BOTTOM_APPLE,
  chatMobileCreateFabBottom,
  chatMobileCreateFabScrimBottom,
  mobileCreateFabActions,
} from "../chat-mobile-create-fab-actions";

describe("mobileCreateFabActions", () => {
  it("returns home actions with existing create routes", () => {
    expect(mobileCreateFabActions("home")).toEqual([
      { id: "newTask", href: "/tasks?create=true" },
      { id: "createChannel", href: "/chat?create=channel" },
      { id: "newDm", href: "/chat?dm=new" },
    ]);
  });

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
