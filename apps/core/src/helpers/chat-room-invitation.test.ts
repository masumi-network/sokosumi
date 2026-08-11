import { HTTPException } from "hono/http-exception";
import { describe, expect, it, vi } from "vitest";

import {
  assertChatRoomInvitationRateLimits,
  assertInviteeNotHostOrgMember,
  assertInviteeNotRoomMember,
  expireStalePendingInvitations,
  INVITE_TTL_MS,
  invitationExpiresAt,
  livePendingInvitationWhere,
  mapChatRoomInvitation,
  mapChatRoomInvitationFromRecord,
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

describe("mapChatRoomInvitationFromRecord", () => {
  it("maps invitation + room context, with optional status override", () => {
    const mapped = mapChatRoomInvitationFromRecord(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        email: "guest@example.com",
        status: "pending",
        inviter: { id: "user_123", name: "Jane Doe" },
        expiresAt: new Date("2026-08-12T12:00:00.000Z"),
        createdAt: new Date("2026-08-05T12:00:00.000Z"),
      },
      {
        id: "550e8400-e29b-41d4-a716-446655440001",
        name: "Client Room",
        organizationId: "org_123",
        organizationName: "Acme Corp",
      },
      { status: "accepted" },
    );

    expect(mapped).toMatchObject({
      roomId: "550e8400-e29b-41d4-a716-446655440001",
      roomName: "Client Room",
      organizationName: "Acme Corp",
      status: "accepted",
      inviter: { id: "user_123", name: "Jane Doe" },
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

describe("assertInviteeNotRoomMember", () => {
  it("allows when the email has no room membership", async () => {
    const tx = {
      chatRoomUserMember: { findFirst: vi.fn().mockResolvedValue(null) },
    };

    await expect(
      assertInviteeNotRoomMember("room_1", "guest@example.com", tx as never),
    ).resolves.toBeUndefined();
  });

  it("rejects when the email is already a guest", async () => {
    const tx = {
      chatRoomUserMember: {
        findFirst: vi.fn().mockResolvedValue({ id: "mem_1", access: "guest" }),
      },
    };

    await expect(
      assertInviteeNotRoomMember("room_1", "guest@example.com", tx as never),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException &&
        error.status === 400 &&
        error.message.includes("already a guest"),
    );
  });

  it("rejects when the email is already a member", async () => {
    const tx = {
      chatRoomUserMember: {
        findFirst: vi.fn().mockResolvedValue({ id: "mem_1", access: "member" }),
      },
    };

    await expect(
      assertInviteeNotRoomMember("room_1", "member@example.com", tx as never),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException &&
        error.status === 400 &&
        error.message.includes("already a member"),
    );
  });
});

describe("livePendingInvitationWhere", () => {
  it("requires pending status and expiresAt after now", () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    expect(livePendingInvitationWhere("room_1", now)).toEqual({
      roomId: "room_1",
      status: "pending",
      expiresAt: { gt: now },
    });
  });
});

describe("expireStalePendingInvitations", () => {
  it("marks past-due pending invites expired", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = { chatRoomGuestInvitation: { updateMany } };
    const now = new Date("2026-08-10T12:00:00.000Z");

    await expect(
      expireStalePendingInvitations(tx as never, {
        roomId: "room_1",
        now,
      }),
    ).resolves.toBe(2);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: "pending",
        expiresAt: { lte: now },
        roomId: "room_1",
      },
      data: { status: "expired" },
    });
  });
});

describe("assertChatRoomInvitationRateLimits", () => {
  it("allows under both caps", async () => {
    const tx = {
      chatRoomGuestInvitation: {
        count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(3),
      },
    };

    await expect(
      assertChatRoomInvitationRateLimits("room_1", "user_1", tx as never),
    ).resolves.toBeUndefined();
  });

  it("rejects when pending per room is at the cap", async () => {
    const tx = {
      chatRoomGuestInvitation: {
        count: vi.fn().mockResolvedValue(100),
      },
    };

    await expect(
      assertChatRoomInvitationRateLimits("room_1", "user_1", tx as never),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException &&
        error.status === 429 &&
        error.message.includes("pending invitations"),
    );
  });

  it("rejects when inviter hourly create cap is hit", async () => {
    const tx = {
      chatRoomGuestInvitation: {
        count: vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(30),
      },
    };

    await expect(
      assertChatRoomInvitationRateLimits("room_1", "user_1", tx as never),
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof HTTPException &&
        error.status === 429 &&
        error.message.includes("per hour"),
    );
  });

  it("counts only live pending (expiresAt filter)", async () => {
    const count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    const tx = { chatRoomGuestInvitation: { count } };
    const now = new Date("2026-08-10T12:00:00.000Z");

    await assertChatRoomInvitationRateLimits(
      "room_1",
      "user_1",
      tx as never,
      now,
    );

    expect(count.mock.calls[0]?.[0]).toEqual({
      where: {
        roomId: "room_1",
        status: "pending",
        expiresAt: { gt: now },
      },
    });
  });
});
