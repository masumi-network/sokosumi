import { describe, expect, it } from "vitest";

import {
  isMainAppMobileChromePathname,
  resolveMobileAppBackTarget,
  shouldShowMobileBottomNav,
  shouldShowMobileBrandLeading,
} from "../mobile-app-chrome";

describe("mobile-app-chrome", () => {
  describe("isMainAppMobileChromePathname", () => {
    it("matches exact main list routes only", () => {
      expect(isMainAppMobileChromePathname("/tasks")).toBe(true);
      expect(isMainAppMobileChromePathname("/projects")).toBe(true);
      expect(isMainAppMobileChromePathname("/agents")).toBe(true);
      expect(isMainAppMobileChromePathname("/history")).toBe(true);
      expect(isMainAppMobileChromePathname("/personal-assistant")).toBe(true);
      expect(isMainAppMobileChromePathname("/admin")).toBe(true);
      expect(isMainAppMobileChromePathname("/notifications")).toBe(true);
      expect(isMainAppMobileChromePathname("/tasks/abc")).toBe(false);
      expect(isMainAppMobileChromePathname("/agents/abc")).toBe(false);
      expect(isMainAppMobileChromePathname("/admin/users")).toBe(false);
      expect(isMainAppMobileChromePathname("/notifications/n1")).toBe(false);
      expect(isMainAppMobileChromePathname("/chat")).toBe(false);
      expect(isMainAppMobileChromePathname(null)).toBe(false);
    });
  });

  describe("resolveMobileAppBackTarget", () => {
    it("returns null on tab list roots (no leading back)", () => {
      expect(resolveMobileAppBackTarget("/tasks")).toBeNull();
      expect(resolveMobileAppBackTarget("/agents")).toBeNull();
      expect(resolveMobileAppBackTarget("/projects")).toBeNull();
      expect(resolveMobileAppBackTarget("/history")).toBeNull();
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
    });

    it("returns null outside the main hub tree", () => {
      expect(resolveMobileAppBackTarget("/chat")).toBeNull();
      expect(resolveMobileAppBackTarget("/chat/rooms/r1")).toBeNull();
      expect(resolveMobileAppBackTarget("/account")).toBeNull();
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
      ).toBe(false);
      expect(
        shouldShowMobileBottomNav("/", new URLSearchParams("create=channel")),
      ).toBe(false);
    });

    it("shows on main hub list routes", () => {
      expect(shouldShowMobileBottomNav("/tasks")).toBe(true);
      expect(shouldShowMobileBottomNav("/agents")).toBe(true);
      expect(shouldShowMobileBottomNav("/projects")).toBe(true);
      expect(shouldShowMobileBottomNav("/history")).toBe(true);
      expect(shouldShowMobileBottomNav("/admin")).toBe(true);
      expect(shouldShowMobileBottomNav("/notifications")).toBe(true);
    });

    it("hides on nested detail and unrelated routes", () => {
      expect(shouldShowMobileBottomNav("/tasks/t1")).toBe(false);
      expect(shouldShowMobileBottomNav("/agents/a1")).toBe(false);
      expect(shouldShowMobileBottomNav("/admin/users")).toBe(false);
      expect(shouldShowMobileBottomNav("/notifications/n1")).toBe(false);
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
      expect(shouldShowMobileBrandLeading("/agents")).toBe(true);
      expect(shouldShowMobileBrandLeading("/projects")).toBe(true);
      expect(shouldShowMobileBrandLeading("/history")).toBe(true);
    });

    it("hides brand for rooms, drafts, hubs, and nested detail", () => {
      expect(shouldShowMobileBrandLeading("/chat/rooms/r1")).toBe(false);
      expect(
        shouldShowMobileBrandLeading(
          "/",
          new URLSearchParams("create=channel"),
        ),
      ).toBe(false);
      expect(
        shouldShowMobileBrandLeading("/", new URLSearchParams("dm=new")),
      ).toBe(false);
      expect(shouldShowMobileBrandLeading("/tasks/t1")).toBe(false);
      expect(shouldShowMobileBrandLeading("/personal-assistant")).toBe(false);
      expect(shouldShowMobileBrandLeading("/account")).toBe(false);
    });
  });
});
