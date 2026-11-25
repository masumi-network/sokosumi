import { describe, expect, it } from "vitest";

import {
  CHAT_MOBILE_COMPOSER_SAFE_AREA_PB,
  CHAT_MOBILE_COMPOSER_SAFE_AREA_PB_MD,
  CHAT_MOBILE_HEIGHT_SHELL_CLASS,
  CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
  CHAT_MOBILE_TABS,
  chatMobileComposerSafeAreaPbClass,
  chatMobileHeightShellClass,
} from "./chat-mobile-tab-registry";

describe("Newsletter mobile tab selection", () => {
  it.each([
    "/newsletter",
    "/newsletter/issues",
    "/newsletter/subscribers",
    "/newsletter/signup-form",
    "/newsletter/analytics",
    "/newsletter/settings",
    "/newsletter/issues/issue-1",
  ])("selects Home on %s", (pathname) => {
    expect(
      CHAT_MOBILE_TABS.filter((tab) => tab.isActive(pathname)).map(
        (tab) => tab.id,
      ),
    ).toEqual(["home"]);
  });
});

describe("You row mobile tab selection", () => {
  const activeTabs = (pathname: string, search = "") =>
    CHAT_MOBILE_TABS.filter((tab) =>
      tab.isActive(pathname, new URLSearchParams(search)),
    ).map((tab) => tab.id);

  it.each([
    "/history",
    "/agents",
    "/schedules",
    "/calendar",
    "/studio",
    "/tiktok-studio",
    "/social",
    "/contacts",
    "/drive",
  ])("selects You on %s opened from You, Home otherwise", (pathname) => {
    expect(activeTabs(pathname, "from=you")).toEqual(["you"]);
    expect(activeTabs(pathname)).toEqual(["home"]);
  });

  it("keeps the project on a You row and still selects You", () => {
    expect(activeTabs("/tiktok-studio", "project=p1&from=you")).toEqual([
      "you",
    ]);
  });

  // A project's post preview opens Social accounts: Home, as before.
  it("selects Home on Social opened from a project", () => {
    expect(activeTabs("/social", "projectId=p1&tab=accounts")).toEqual([
      "home",
    ]);
  });

  // The Feed replaces the room list on the Chats tab in feed mode. Without
  // its own match the tab bar lights no tab, or Home, on the Feed page.
  it("selects Chats on the Feed and on Catch up", () => {
    expect(activeTabs("/chat/feed")).toEqual(["chats"]);
    expect(activeTabs("/chat/catch-up")).toEqual(["chats"]);
  });

  it("keeps Home on Home and the inbox", () => {
    expect(activeTabs("/", "from=you")).toEqual(["home"]);
    expect(activeTabs("/notifications", "from=you")).toEqual(["home"]);
  });
});

describe("chatMobileHeightShellClass", () => {
  it("uses no-tab-bar shell for rooms", () => {
    expect(chatMobileHeightShellClass("/chat/rooms/r1")).toBe(
      CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS,
    );
  });

  it("keeps tab-bar shell for retired draft DM query", () => {
    expect(
      chatMobileHeightShellClass("/chat", false, new URLSearchParams("dm=new")),
    ).toBe(CHAT_MOBILE_HEIGHT_SHELL_CLASS);
  });

  // `welcome=1` used to open the questionnaire and hide the tab bar with it.
  // The landing replaced that flow, so a stray link carrying the old param must
  // fall through to plain home chrome rather than lose the tab bar.
  it("keeps tab-bar shell for the retired welcome param", () => {
    expect(
      chatMobileHeightShellClass(
        "/chat",
        false,
        new URLSearchParams("welcome=1"),
      ),
    ).toBe(CHAT_MOBILE_HEIGHT_SHELL_CLASS);
  });

  it("keeps tab-bar shell for retired create-channel query", () => {
    expect(
      chatMobileHeightShellClass(
        "/chat",
        false,
        new URLSearchParams("create=channel"),
      ),
    ).toBe(CHAT_MOBILE_HEIGHT_SHELL_CLASS);
  });

  it("keeps tab-bar shell on home and chats", () => {
    expect(chatMobileHeightShellClass("/")).toBe(
      CHAT_MOBILE_HEIGHT_SHELL_CLASS,
    );
    expect(chatMobileHeightShellClass("/chat")).toBe(
      CHAT_MOBILE_HEIGHT_SHELL_CLASS,
    );
  });

  it("uses rem header offset + top safe-area (not fixed 64px)", () => {
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).toContain(
      "100dvh-4rem-env(safe-area-inset-top)",
    );
    expect(CHAT_MOBILE_HEIGHT_SHELL_CLASS).not.toContain("64px");
    expect(CHAT_MOBILE_HEIGHT_SHELL_NO_TAB_BAR_CLASS).toBe(
      "h-[calc(100dvh-4rem-env(safe-area-inset-top))]",
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
