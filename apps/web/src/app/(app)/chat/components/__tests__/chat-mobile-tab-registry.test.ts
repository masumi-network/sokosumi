import { describe, expect, it } from "vitest";

import {
  CHAT_MOBILE_COMPOSER_SAFE_AREA_PB,
  CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD,
  CHAT_MOBILE_HEIGHT_SHELL_CLASS,
  CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
  chatMobileComposerSafeAreaPbClass,
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

  it("uses rem header offset + top safe-area (not fixed 64px)", () => {
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).toContain(
      "100svh-4rem-env(safe-area-inset-top)",
    );
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).not.toContain("64px");
    expect(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS).toBe(
      "h-[calc(100svh-4rem-env(safe-area-inset-top))]",
    );
    expect(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS).not.toContain("64px");
  });
});

describe("CHAT_MOBILE_COMPOSER_SAFE_AREA_PB", () => {
  it("matches Apple float bottom inset on mobile", () => {
    expect(CHAT_MOBILE_COMPOSER_SAFE_AREA_PB).toBe(
      "pb-[max(0.75rem,env(safe-area-inset-bottom))]",
    );
    expect(CHAT_MOBILE_COMPOSER_SAFE_AREA_PB).toContain(
      "max(0.75rem,env(safe-area-inset-bottom))",
    );
  });

  it("keeps larger desktop md pb path", () => {
    expect(CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD).toBe(
      "md:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
    );
  });

  it("includes mobile safe-area pb when keyboard is closed", () => {
    expect(chatMobileComposerSafeAreaPbClass(false)).toBe(
      `${CHAT_MOBILE_COMPOSER_SAFE_AREA_PB} ${CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD}`,
    );
  });

  it("drops mobile safe-area pb when keyboard is open", () => {
    expect(chatMobileComposerSafeAreaPbClass(true)).toBe(
      CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD,
    );
    expect(chatMobileComposerSafeAreaPbClass(true)).not.toContain(
      CHAT_MOBILE_COMPOSER_SAFE_AREA_PB,
    );
  });
});
