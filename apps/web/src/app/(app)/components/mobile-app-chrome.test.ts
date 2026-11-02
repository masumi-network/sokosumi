import { describe, expect, it } from "vitest";

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
    "/newsletter/calendar",
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

    it("sends nested pages back to their list root", () => {
      expect(resolveMobileAppBackTarget("/tasks/t1")).toEqual({
        href: "/tasks",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/agents/a1/jobs")).toEqual({
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
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/you/help")).toEqual({
        href: "/you",
        labelKey: "back",
      });
      expect(resolveMobileAppBackTarget("/you/legal")).toEqual({
        href: "/you",
        labelKey: "back",
      });
    });

    it("returns null outside the main hub tree", () => {
      expect(resolveMobileAppBackTarget("/chat")).toBeNull();
      expect(resolveMobileAppBackTarget("/chat/rooms/r1")).toBeNull();
      expect(resolveMobileAppBackTarget("/account")).toBeNull();
      expect(resolveMobileAppBackTarget("/developer/docs")).toBeNull();
      expect(resolveMobileAppBackTarget("/billing")).toBeNull();
      expect(resolveMobileAppBackTarget(null)).toBeNull();
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
  });
});
