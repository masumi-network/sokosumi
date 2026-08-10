import { describe, expect, it } from "vitest";

import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";

import {
  type CoworkerAccessEntry,
  coworkerAccessStatusMessageKey,
  isAccessDeniedOrRevoked,
  isAccessGranted,
  isAccessPending,
  toCoworkerAccessEntries,
} from "../coworker-access-display";

function access(
  status: CoworkerWorkspaceAccess["status"],
): CoworkerWorkspaceAccess {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    coworkerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    coworkerName: "Hannah",
    coworkerSlug: "hannah",
    workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    workspaceKind: "user",
    workspaceDisplayName: "Ada Lovelace",
    workspaceDisplayDetail: "ada@example.com",
    status,
    requestedByUserId: null,
    resolvedAt: null,
    resolvedById: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

function entry(status: CoworkerWorkspaceAccess["status"]): CoworkerAccessEntry {
  return {
    coworkerName: "Hannah",
    coworkerSlug: "hannah",
    access: access(status),
  };
}

describe("coworker-access-display", () => {
  it("detects pending, granted, and terminal statuses", () => {
    expect(isAccessPending(entry("PENDING"))).toBe(true);
    expect(isAccessGranted(entry("GRANTED"))).toBe(true);
    expect(isAccessDeniedOrRevoked(entry("DENIED"))).toBe(true);
    expect(isAccessDeniedOrRevoked(entry("REVOKED"))).toBe(true);
    expect(isAccessPending(entry("GRANTED"))).toBe(false);
    expect(isAccessGranted(entry("PENDING"))).toBe(false);
  });

  it("maps status to message keys", () => {
    expect(coworkerAccessStatusMessageKey("PENDING")).toBe("statusPending");
    expect(coworkerAccessStatusMessageKey("GRANTED")).toBe("statusGranted");
    expect(coworkerAccessStatusMessageKey("DENIED")).toBe("statusDenied");
    expect(coworkerAccessStatusMessageKey("REVOKED")).toBe("statusRevoked");
  });

  it("maps Core rows into display entries", () => {
    expect(toCoworkerAccessEntries([access("PENDING")])).toEqual([
      entry("PENDING"),
    ]);
  });
});
