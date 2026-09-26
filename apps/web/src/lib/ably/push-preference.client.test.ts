import { beforeEach, describe, expect, it } from "vitest";

import {
  forgetPushPreference,
  hasPushPreference,
  rememberPushPreference,
  resumePushPreferenceForSession,
  wantsPushHere,
} from "./push-preference.client";

beforeEach(() => localStorage.clear());

describe("SOK-1120 browser consent", () => {
  it("survives removal of SDK credentials and belongs to one reader", () => {
    rememberPushPreference("alice");
    localStorage.removeItem("ably.push.deviceIdentityToken");
    expect(wantsPushHere("alice")).toBe(true);
    expect(wantsPushHere("bob")).toBe(false);
  });
  it("suspends delivery until a confirmed sign-in", () => {
    resumePushPreferenceForSession("alice", "old-session", 100);
    rememberPushPreference("alice", true);
    expect(wantsPushHere("alice")).toBe(false);
    expect(resumePushPreferenceForSession("alice", "old-session", 100)).toBe(
      false,
    );
    expect(resumePushPreferenceForSession("alice", "older-session", 50)).toBe(
      false,
    );
    expect(resumePushPreferenceForSession("alice", "new-session", 200)).toBe(
      true,
    );
    expect(wantsPushHere("alice")).toBe(true);
    expect(wantsPushHere("bob")).toBe(false);
  });
  it("does not restore an explicit opt-out after sign-in", () => {
    rememberPushPreference("alice");
    forgetPushPreference();
    expect(resumePushPreferenceForSession("alice", "new-session", 200)).toBe(
      false,
    );
    expect(wantsPushHere("alice")).toBe(false);
  });
  it("treats malformed storage as no consent", () => {
    for (const value of [
      "{",
      "null",
      '{"userId":"alice","suspended":"false"}',
    ]) {
      localStorage.setItem("sokosumi.push.preference", value);
      expect(hasPushPreference()).toBe(false);
      expect(wantsPushHere("alice")).toBe(false);
    }
  });
});

it("does not let an older tab overwrite the session remembered for logout", () => {
  resumePushPreferenceForSession("alice", "recent", 200);
  rememberPushPreference("alice");
  resumePushPreferenceForSession("alice", "stale", 100);
  rememberPushPreference("alice", true);
  expect(resumePushPreferenceForSession("alice", "recent", 200)).toBe(false);
  expect(wantsPushHere("alice")).toBe(false);
});
