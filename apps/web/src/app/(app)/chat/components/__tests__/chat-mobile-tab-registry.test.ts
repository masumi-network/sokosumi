import { describe, expect, it } from "vitest";

import {
  CHAT_MOBILE_HEIGHT_SHELL_CLASS,
  CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
  chatMobileHeightShellClass,
} from "../chat-mobile-tab-registry";

describe("chatMobileHeightShellClass", () => {
  it("uses no-tab-bar shell for rooms", () => {
    expect(chatMobileHeightShellClass("/chat/rooms/r1")).toBe(
      CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
    );
  });

  it("uses no-tab-bar shell for draft DM compose", () => {
    expect(
      chatMobileHeightShellClass("/chat", false, new URLSearchParams("dm=new")),
    ).toBe(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS);
  });

  it("uses no-tab-bar shell for welcome compose", () => {
    expect(
      chatMobileHeightShellClass(
        "/chat",
        false,
        new URLSearchParams("welcome=1"),
      ),
    ).toBe(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS);
  });

  it("uses no-tab-bar shell for create-channel draft", () => {
    expect(
      chatMobileHeightShellClass(
        "/chat",
        false,
        new URLSearchParams("create=channel"),
      ),
    ).toBe(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS);
  });

  it("keeps tab-bar shell on home and chats", () => {
    expect(chatMobileHeightShellClass("/chat")).toBe(
      CHAT_MOBILE_HEIGHT_SHELL_CLASS,
    );
    expect(chatMobileHeightShellClass("/chat/chats")).toBe(
      CHAT_MOBILE_HEIGHT_SHELL_CLASS,
    );
  });

  it("uses rem header offset (not fixed 64px) so Dynamic Type can scale", () => {
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).toContain("100svh-4rem");
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).not.toContain("64px");
    expect(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS).toBe(
      "h-[calc(100svh-4rem)]",
    );
    expect(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS).not.toContain("64px");
  });
});
