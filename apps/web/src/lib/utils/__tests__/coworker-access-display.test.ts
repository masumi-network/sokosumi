import { describe, expect, it } from "vitest";

import type { CoworkerWorkspaceAccess } from "@/lib/clients/generated/core";

import {
  type CoworkerAccessEntry,
  isAccessDeniedOrRevoked,
  isAccessGranted,
  isAccessPending,
} from "../coworker-access-display";

function entry(status: CoworkerWorkspaceAccess["status"]): CoworkerAccessEntry {
  return {
    coworkerName: "Hannah",
    coworkerSlug: "hannah",
    access: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      coworkerId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspaceId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status,
      requestedByUserId: null,
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
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
});
