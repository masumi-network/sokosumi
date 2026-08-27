import assert from "node:assert/strict";

import { describe, it } from "vitest";

import type { Prisma } from "../generated/prisma/client.js";
import { organizationInviteLinkRepository } from "./organization-invite-link.repository.js";

describe("organizationInviteLinkRepository.listInviteLinksByOrganizationId", () => {
  it("queries by organizationId ordered by createdAt desc", async () => {
    let findManyArgs: unknown;
    const rows = [
      {
        id: "link_1",
        token: "tok_1",
        organizationId: "org_1",
        role: "member",
        createdByUserId: "user_1",
        createdAt: new Date("2026-07-25T12:00:00.000Z"),
        expiresAt: new Date("2026-08-01T12:00:00.000Z"),
        revokedAt: null,
        maxUses: null,
        useCount: 0,
      },
    ];
    const tx = {
      organizationInviteLink: {
        findMany: async (args: unknown) => {
          findManyArgs = args;
          return rows;
        },
      },
    } as unknown as Prisma.TransactionClient;

    const result =
      await organizationInviteLinkRepository.listInviteLinksByOrganizationId(
        "org_1",
        tx,
      );

    assert.equal(result, rows);
    assert.deepEqual(findManyArgs, {
      where: { organizationId: "org_1" },
      orderBy: { createdAt: "desc" },
    });
  });
});
