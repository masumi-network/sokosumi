import type { Prisma } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import {
  tryConsumeChatRoomGuestInviteLink,
  tryConsumeOrganizationInviteLink,
} from "./invite-link-consume";

describe("tryConsumeOrganizationInviteLink", () => {
  it("increments when live and under maxUses", async () => {
    let updateManyArgs: unknown;
    const tx = {
      organizationInviteLink: {
        updateMany: async (args: unknown) => {
          updateManyArgs = args;
          return { count: 1 };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const now = new Date("2026-08-05T00:00:00.000Z");
    const ok = await tryConsumeOrganizationInviteLink(
      { id: "link_1", now, maxUses: 5 },
      tx,
    );

    expect(ok).toBe(true);
    expect(updateManyArgs).toEqual({
      where: {
        id: "link_1",
        revokedAt: null,
        expiresAt: { gt: now },
        useCount: { lt: 5 },
      },
      data: { useCount: { increment: 1 } },
    });
  });

  it("omits useCount when maxUses is null", async () => {
    let updateManyArgs: unknown;
    const tx = {
      organizationInviteLink: {
        updateMany: async (args: unknown) => {
          updateManyArgs = args;
          return { count: 1 };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const now = new Date("2026-08-05T00:00:00.000Z");
    await tryConsumeOrganizationInviteLink(
      { id: "link_1", now, maxUses: null },
      tx,
    );

    expect(updateManyArgs).toEqual({
      where: {
        id: "link_1",
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { useCount: { increment: 1 } },
    });
  });

  it("returns false when no row matched", async () => {
    const tx = {
      organizationInviteLink: {
        updateMany: async () => ({ count: 0 }),
      },
    } as unknown as Prisma.TransactionClient;

    const ok = await tryConsumeOrganizationInviteLink(
      { id: "link_1", now: new Date(), maxUses: 1 },
      tx,
    );

    expect(ok).toBe(false);
  });
});

describe("tryConsumeChatRoomGuestInviteLink", () => {
  it("increments when live and under maxUses", async () => {
    let updateManyArgs: unknown;
    const tx = {
      chatRoomGuestInviteLink: {
        updateMany: async (args: unknown) => {
          updateManyArgs = args;
          return { count: 1 };
        },
      },
    } as unknown as Prisma.TransactionClient;

    const now = new Date("2026-08-05T00:00:00.000Z");
    const ok = await tryConsumeChatRoomGuestInviteLink(
      { id: "link_1", now, maxUses: 5 },
      tx,
    );

    expect(ok).toBe(true);
    expect(updateManyArgs).toEqual({
      where: {
        id: "link_1",
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        useCount: { lt: 5 },
      },
      data: { useCount: { increment: 1 } },
    });
  });
});
