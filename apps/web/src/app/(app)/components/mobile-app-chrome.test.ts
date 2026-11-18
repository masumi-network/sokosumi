import { describe, expect, it } from "vitest";

import { SOKO_BOT_FROM_HOME_ROUTE } from "@/lib/soko-bot/constants";
import {
  resolveMobileAppBackTarget,
  shouldShowMobileBottomNav,
  shouldShowMobileBrandLeading,
} from "./mobile-app-chrome";

describe("mobile-app-chrome", () => {
  it.each([
    "/newsletter",
    "/newsletter/issues",
    "/newsletter/subscribers",
    "/newsletter/signup-form",
    "/newsletter/analytics",
    "/newsletter/settings",
  ])("uses Social-style list chrome on %s", (pathname) => {
    expect(shouldShowMobileBottomNav(pathname)).toBe(true);
    expect(shouldShowMobileBrandLeading(pathname)).toBe(false);
    expect(resolveMobileAppBackTarget(pathname)).toEqual({
      href: "/",
      labelKey: "back",
    });
  });

  it("returns from a newsletter issue to its project-scoped list", () => {
    const pathname = "/newsletter/issues/issue-1";
    expect(shouldShowMobileBottomNav(pathname)).toBe(false);
    expect(shouldShowMobileBrandLeading(pathname)).toBe(false);
    expect(
      resolveMobileAppBackTarget(
        pathname,
        new URLSearchParams("projectId=project%2Fone&cursor=old"),
      ),
    ).toEqual({
      href: "/newsletter/issues?projectId=project%2Fone",
      labelKey: "back",
    });
    expect(resolveMobileAppBackTarget(pathname)).toEqual({
      href: "/newsletter/issues",
      labelKey: "back",
    });
  });

  describe("resolveMobileAppBackTarget", () => {
    it("returns null on tab list roots (no leading back)", () => {
      expect(resolveMobileAppBackTarget("/tasks")).toBeNull();
      expect(resolveMobileAppBackTarget("/projects")).toBeNull();
      expect(resolveMobileAppBackTarget("/history")).toBeNull();
    });

    it("sends agents, drive, calendar, schedules, social and studio roots back to home", () => {
      expect(resolveMobileAppBackTarget("/agents")).toEqual({
        href: "/",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/drive")).toEqual({
        href: "/",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/calendar")).toEqual({
        href: "/",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/schedules")).toEqual({
        href: "/",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/studio")).toEqual({
        href: "/",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/social")).toEqual({
        href: "/",
        labelKey: "back",
      });
    });

    const YOU_ROWS = [
      "/history",
      "/agents",
      "/schedules",
      "/calendar",
      "/studio",
      "/tiktok-studio",
      "/social",
      "/contacts",
      "/drive",
    ];

    it.each(YOU_ROWS)("sends %s opened from You back to You", (pathname) => {
      expect(resolveMobileAppBackTarget(pathname, null, true)).toEqual({
        href: "/you",
        labelKey: "backToYou",
      });
    });

    it("keeps a project-scoped page opened from You going back to You", () => {
      expect(
        resolveMobileAppBackTarget(
          "/tiktok-studio",
          new URLSearchParams("project=p1"),
          true,
        ),
      ).toEqual({ href: "/you", labelKey: "backToYou" });
    });

    // A project's post preview links to its Social accounts: not from You.
    it("keeps Social opened from a project going back to Home", () => {
      expect(
        resolveMobileAppBackTarget(
          "/social",
          new URLSearchParams("projectId=p1&tab=accounts"),
        ),
      ).toEqual({ href: "/", labelKey: "back" });
    });

    it("keeps nested pages of a You row going back to their list", () => {
      expect(resolveMobileAppBackTarget("/agents/a1", null, true)).toEqual({
        href: "/agents",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/schedules/s1", null, true)).toEqual({
        href: "/schedules",
        labelKey: "back",
      });
    });

    it("sends nested studio paths back to the studio root", () => {
      expect(resolveMobileAppBackTarget("/studio/x")).toEqual({
        href: "/studio",
        labelKey: "back",
      });
    });

    it("sends a schedule back to the Schedules list", () => {
      expect(resolveMobileAppBackTarget("/schedules/schedule-1")).toEqual({
        href: "/schedules",
        labelKey: "back",
      });
    });

    it("sends non-tab hub roots back to Chats", () => {
      expect(resolveMobileAppBackTarget("/personal-assistant")).toEqual({
        href: "/chat",
        labelKey: "backToChats",
      });
      expect(resolveMobileAppBackTarget("/admin")).toEqual({
        href: "/chat",
        labelKey: "backToChats",
      });
      expect(resolveMobileAppBackTarget("/notifications")).toEqual({
        href: "/chat",
        labelKey: "backToChats",
      });
    });

    it("sends Soko Bot setup opened from Home back to Home", () => {
      const fromHome = new URL(SOKO_BOT_FROM_HOME_ROUTE, "https://x.test");
      expect(
        resolveMobileAppBackTarget(fromHome.pathname, fromHome.searchParams),
      ).toEqual({ href: "/", labelKey: "goHome" });
    });

    it("sends an agent's jobs back to that agent, not the catalog", () => {
      expect(resolveMobileAppBackTarget("/agents/a1/jobs")).toEqual({
        href: "/agents/a1",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/agents/a1/jobs/j1")).toEqual({
        href: "/agents/a1",
        labelKey: "back",
      });
    });

    it("sends nested pages back to their list root", () => {
      expect(resolveMobileAppBackTarget("/tasks/t1")).toEqual({
        href: "/tasks",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/agents/a1")).toEqual({
        href: "/agents",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/projects/p1/edit")).toEqual({
        href: "/projects",
        labelKey: "back",
      });
      expect(
        resolveMobileAppBackTarget("/personal-assistant/settings"),
      ).toEqual({
        href: "/personal-assistant",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/admin/users")).toEqual({
        href: "/admin",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/admin/coworkers/c1")).toEqual({
        href: "/admin",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/notifications/n1")).toEqual({
        href: "/notifications",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/you/developer")).toEqual({
        href: "/you",
        labelKey: "backToYou",
      });
      expect(resolveMobileAppBackTarget("/you/help")).toEqual({
        href: "/you",
        labelKey: "backToYou",
      });
      expect(resolveMobileAppBackTarget("/you/legal")).toEqual({
        href: "/you",
        labelKey: "backToYou",
      });
    });

    it("returns null outside the main hub tree", () => {
      expect(resolveMobileAppBackTarget("/chat")).toBeNull();
      expect(resolveMobileAppBackTarget("/chat/rooms/r1")).toBeNull();
      expect(resolveMobileAppBackTarget("/accounts")).toBeNull();
      expect(resolveMobileAppBackTarget(null)).toBeNull();
    });

    it.each([
      "/developer",
      "/developer/docs",
      "/developer/oauth-clients",
      "/developer/api-keys",
      "/developer/vendors",
      "/developer/coworkers",
      "/developer/tasks",
    ])("sends Developer section %s back to the Developer menu", (pathname) => {
      expect(resolveMobileAppBackTarget(pathname)).toEqual({
        href: "/you/developer",
        labelKey: "back",
      });
    });

    it.each([
      ["/developer/coworkers/c1", "/developer/coworkers"],
      ["/developer/tasks/t1", "/developer/tasks"],
      ["/developer/vendors/v1", "/developer/vendors"],
    ])("sends Developer detail %s back to its list", (pathname, href) => {
      expect(resolveMobileAppBackTarget(pathname)).toEqual({
        href,
        labelKey: "back",
      });
    });

    it.each([
      "/account",
      "/account/notifications",
      "/billing",
      "/connections",
      // Phones open SEO and Ads from the You page.
      "/seo",
      "/ads",
    ])("sends You page row %s back to You", (pathname) => {
      expect(resolveMobileAppBackTarget(pathname)).toEqual({
        href: "/you",
        labelKey: "backToYou",
      });
    });

    it.each(["/ads/campaigns/c1", "/ads/campaigns/c1/edit"])(
      "sends Ads page %s back to its project, account and range",
      (pathname) => {
        expect(
          resolveMobileAppBackTarget(
            pathname,
            new URLSearchParams("projectId=p1&accountId=a1&range=7d"),
          ),
        ).toEqual({
          href: "/ads?projectId=p1&tab=campaigns&account=a1&range=7d",
          labelKey: "back",
        });
      },
    );

    it("drops an unknown range from the Ads list it goes back to", () => {
      expect(
        resolveMobileAppBackTarget(
          "/ads/campaigns/c1",
          new URLSearchParams("projectId=p1&accountId=a1&range=1y"),
        ),
      ).toEqual({
        href: "/ads?projectId=p1&tab=campaigns&account=a1",
        labelKey: "back",
      });
    });

    it("sends an Ads page with no project or account back to Ads", () => {
      expect(resolveMobileAppBackTarget("/ads/campaigns/c1")).toEqual({
        href: "/ads",
        labelKey: "back",
      });
    });
  });

  describe("shouldShowMobileBottomNav", () => {
    it("shows on Welcome home and chats list except rooms and drafts", () => {
      expect(shouldShowMobileBottomNav("/")).toBe(true);
      expect(shouldShowMobileBottomNav("/chat")).toBe(true);
      // `welcome=1` used to open the questionnaire, which hid the nav. The
      // param is retired, so a stale link must now behave like bare home.
      expect(
        shouldShowMobileBottomNav("/", new URLSearchParams("welcome=1")),
      ).toBe(true);
      expect(shouldShowMobileBottomNav("/chat/rooms/r1")).toBe(false);
      expect(
        shouldShowMobileBottomNav("/", new URLSearchParams("dm=new")),
      ).toBe(true);
      expect(
        shouldShowMobileBottomNav("/", new URLSearchParams("create=channel")),
      ).toBe(true);
    });

    it("shows on main hub list routes", () => {
      expect(shouldShowMobileBottomNav("/tasks")).toBe(true);
      expect(shouldShowMobileBottomNav("/agents")).toBe(true);
      expect(shouldShowMobileBottomNav("/projects")).toBe(true);
      expect(shouldShowMobileBottomNav("/you")).toBe(true);
      expect(shouldShowMobileBottomNav("/history")).toBe(true);
      expect(shouldShowMobileBottomNav("/calendar")).toBe(true);
      expect(shouldShowMobileBottomNav("/studio")).toBe(true);
      expect(shouldShowMobileBottomNav("/social")).toBe(true);
      expect(shouldShowMobileBottomNav("/admin")).toBe(true);
      expect(shouldShowMobileBottomNav("/notifications")).toBe(true);
    });

    it("hides on nested detail and unrelated routes", () => {
      expect(shouldShowMobileBottomNav("/tasks/t1")).toBe(false);
      expect(shouldShowMobileBottomNav("/agents/a1")).toBe(false);
      expect(shouldShowMobileBottomNav("/admin/users")).toBe(false);
      expect(shouldShowMobileBottomNav("/notifications/n1")).toBe(false);
      expect(shouldShowMobileBottomNav("/you/developer")).toBe(false);
      expect(shouldShowMobileBottomNav("/you/help")).toBe(false);
      expect(shouldShowMobileBottomNav("/you/legal")).toBe(false);
      expect(shouldShowMobileBottomNav("/studio/x")).toBe(false);
      expect(shouldShowMobileBottomNav("/account")).toBe(false);
      expect(shouldShowMobileBottomNav(null)).toBe(false);
    });
  });

  describe("shouldShowMobileBrandLeading", () => {
    it("shows brand on Welcome, chats, and every bottom-nav tab root", () => {
      expect(shouldShowMobileBrandLeading("/")).toBe(true);
      expect(shouldShowMobileBrandLeading("/chat")).toBe(true);
      // Retired param: falls through to home, so the brand stays.
      expect(
        shouldShowMobileBrandLeading("/", new URLSearchParams("welcome=1")),
      ).toBe(true);
      expect(shouldShowMobileBrandLeading("/tasks")).toBe(true);
      expect(shouldShowMobileBrandLeading("/projects")).toBe(true);
      expect(shouldShowMobileBrandLeading("/you")).toBe(true);
      expect(shouldShowMobileBrandLeading("/history")).toBe(true);
    });

    it("hides brand for rooms, hubs, nested detail, and agents", () => {
      expect(shouldShowMobileBrandLeading("/chat/rooms/r1")).toBe(false);
      expect(
        shouldShowMobileBrandLeading(
          "/",
          new URLSearchParams("create=channel"),
        ),
      ).toBe(true);
      expect(
        shouldShowMobileBrandLeading("/", new URLSearchParams("dm=new")),
      ).toBe(true);
      expect(shouldShowMobileBrandLeading("/tasks/t1")).toBe(false);
      expect(shouldShowMobileBrandLeading("/you/developer")).toBe(false);
      expect(shouldShowMobileBrandLeading("/you/help")).toBe(false);
      expect(shouldShowMobileBrandLeading("/you/legal")).toBe(false);
      expect(shouldShowMobileBrandLeading("/agents")).toBe(false);
      expect(shouldShowMobileBrandLeading("/studio")).toBe(false);
      expect(shouldShowMobileBrandLeading("/social")).toBe(false);
      expect(shouldShowMobileBrandLeading("/studio/x")).toBe(false);
      expect(shouldShowMobileBrandLeading("/personal-assistant")).toBe(false);
      expect(shouldShowMobileBrandLeading("/account")).toBe(false);
    });

    it.each(["/history", "/schedules", "/calendar", "/contacts", "/drive"])(
      "swaps brand for back to You on %s opened from You",
      (pathname) => {
        expect(shouldShowMobileBrandLeading(pathname)).toBe(true);
        expect(shouldShowMobileBrandLeading(pathname, null, true)).toBe(false);
      },
    );
  });
});
