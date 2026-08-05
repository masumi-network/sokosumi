import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  assertInviteeNotHostOrgMember,
  INVITE_TTL_MS,
  invitationExpiresAt,
  mapChatRoomInvitation,
  normalizeInvitationEmail,
} from "./chat-room-invitation";

describe("normalizeInvitationEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeInvitationEmail("  Guest@Example.COM ")).toBe(
      "guest@example.com",
    );
  });
});

describe("INVITE_TTL_MS", () => {
  it("is 7 days in milliseconds", () => {
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe("invitationExpiresAt", () => {
  it("adds INVITE_TTL_MS to the given time", () => {
    const from = new Date("2026-08-05T12:00:00.000Z");
    expect(invitationExpiresAt(from).toISOString()).toBe(
      new Date(from.getTime() + INVITE_TTL_MS).toISOString(),
    );
  });
});

describe("mapChatRoomInvitation", () => {
  it("maps to the invitation DTO", () => {
    const mapped = mapChatRoomInvitation({
      id: "550e8400-e29b-41d4-a716-446655440000",
      roomId: "550e8400-e29b-41d4-a716-446655440001",
      roomName: "Client Room",
      organizationId: "org_123",
      organizationName: "Acme Corp",
      email: "guest@example.com",
      status: "pending",
      inviter: { id: "user_123", name: "Jane Doe" },
      expiresAt: new Date("2026-08-12T12:00:00.000Z"),
      createdAt: new Date("2026-08-05T12:00:00.000Z"),
    });

    expect(mapped).toMatchObject({
      roomName: "Client Room",
      organizationName: "Acme Corp",
      status: "pending",
      inviter: { id: "user_123", name: "Jane Doe" },
      expiresAt: "2026-08-12T12:00:00.000Z",
    });
  });
});

describe("assertInviteeNotHostOrgMember", () => {
  it("allows non-members", async () => {
    const tx = {
      member: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      assertInviteeNotHostOrgMember("org_1", "guest@example.com", tx as never),
    ).resolves.toBeUndefined();
  });

  it("rejects host-org members", async () => {
    const tx = {
      member: { findFirst: vi.fn().mockResolvedValue({ id: "mem_1" }) },
    };

    await expect(
      assertInviteeNotHostOrgMember("org_1", "member@example.com", tx as never),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException &&
        error.status === 400 &&
        error.message.includes("organization member"),
    );
  });
});
