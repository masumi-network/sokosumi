import { describe, expect, it } from "vitest";

import {
  isMainAppMobileChromePathname,
  resolveMobileAppBackTarget,
  shouldShowMobileBottomNav,
  shouldShowMobileBrandLeading,
  shouldShowMobileCreateFab,
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
    it("sends list roots back to Home", () => {
      expect(resolveMobileAppBackTarget("/tasks")).toEqual({
        href: "/chat",
        labelKey: "backToHome",
      });
      expect(resolveMobileAppBackTarget("/agents")).toEqual({
        href: "/chat",
        labelKey: "backToHome",
      });
      expect(resolveMobileAppBackTarget("/history")).toEqual({
        href: "/chat",
        labelKey: "backToHome",
      });
      expect(resolveMobileAppBackTarget("/admin")).toEqual({
        href: "/chat",
        labelKey: "backToHome",
      });
      expect(resolveMobileAppBackTarget("/notifications")).toEqual({
        href: "/chat",
        labelKey: "backToHome",
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
    it("shows on chat shell except rooms and drafts", () => {
      expect(shouldShowMobileBottomNav("/chat")).toBe(true);
      expect(shouldShowMobileBottomNav("/chat/chats")).toBe(true);
      expect(shouldShowMobileBottomNav("/chat/rooms/r1")).toBe(false);
      expect(
        shouldShowMobileBottomNav("/chat", new URLSearchParams("dm=new")),
      ).toBe(false);
      expect(
        shouldShowMobileBottomNav(
          "/chat",
          new URLSearchParams("create=channel"),
        ),
      ).toBe(false);
      expect(
        shouldShowMobileBottomNav("/chat", new URLSearchParams("welcome=1")),
      ).toBe(false);
    });

    it("shows on main hub list routes", () => {
      expect(shouldShowMobileBottomNav("/tasks")).toBe(true);
      expect(shouldShowMobileBottomNav("/agents")).toBe(true);
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
    it("shows brand only on home and chats", () => {
      expect(shouldShowMobileBrandLeading("/chat")).toBe(true);
      expect(shouldShowMobileBrandLeading("/chat/chats")).toBe(true);
      expect(shouldShowMobileBrandLeading("/tasks")).toBe(false);
      expect(shouldShowMobileBrandLeading("/agents")).toBe(false);
    });

    it("hides brand for rooms, drafts, and nested detail", () => {
      expect(shouldShowMobileBrandLeading("/chat/rooms/r1")).toBe(false);
      expect(
        shouldShowMobileBrandLeading(
          "/chat",
          new URLSearchParams("create=channel"),
        ),
      ).toBe(false);
      expect(
        shouldShowMobileBrandLeading("/chat", new URLSearchParams("dm=new")),
      ).toBe(false);
      expect(
        shouldShowMobileBrandLeading("/chat", new URLSearchParams("welcome=1")),
      ).toBe(false);
      expect(shouldShowMobileBrandLeading("/tasks/t1")).toBe(false);
      expect(shouldShowMobileBrandLeading("/account")).toBe(false);
    });
  });

  describe("shouldShowMobileCreateFab", () => {
    it("shows on home and chats only", () => {
      expect(shouldShowMobileCreateFab("/chat")).toBe(true);
      expect(shouldShowMobileCreateFab("/chat/chats")).toBe(true);
      expect(shouldShowMobileCreateFab("/tasks")).toBe(false);
      expect(shouldShowMobileCreateFab("/chat/rooms/r1")).toBe(false);
    });

    it("hides for drafts and welcome compose", () => {
      expect(
        shouldShowMobileCreateFab(
          "/chat",
          new URLSearchParams("create=channel"),
        ),
      ).toBe(false);
      expect(
        shouldShowMobileCreateFab("/chat", new URLSearchParams("dm=new")),
      ).toBe(false);
      expect(
        shouldShowMobileCreateFab("/chat", new URLSearchParams("welcome=1")),
      ).toBe(false);
    });
  });
});
