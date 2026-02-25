import type { Prisma } from "@sokosumi/database";
import {
  convertCreditsToCents,
  getOrganizationMemberSubscriptionReferencePrefix,
} from "@sokosumi/database/helpers";
import { describe, expect, it, vi } from "vitest";

import { attachCreditsToOrganizations } from "./credits";

describe("attachCreditsToOrganizations", () => {
  it("returns empty array without querying when no members are provided", async () => {
    const queryRaw = vi.fn();
    const tx = {
      $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;

    const result = await attachCreditsToOrganizations([], "user_1", tx);

    expect(result).toEqual([]);
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it("maps balances using shared org credits and member-scoped subscription credits", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        organization_id: "org_1",
        balance: convertCreditsToCents(10),
      },
      {
        organization_id: "org_2",
        balance: convertCreditsToCents(4),
      },
    ]);

    const tx = {
      $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;

    const result = await attachCreditsToOrganizations(
      [
        {
          organization: { id: "org_1" },
          role: "member",
        },
        {
          organization: { id: "org_2" },
          role: "admin",
        },
        {
          organization: { id: "org_3" },
          role: "owner",
        },
      ],
      "user_1",
      tx,
    );

    expect(result).toEqual([
      {
        id: "org_1",
        role: "member",
        credits: 10,
      },
      {
        id: "org_2",
        role: "admin",
        credits: 4,
      },
      {
        id: "org_3",
        role: "owner",
        credits: 0,
      },
    ]);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]).toEqual(
      expect.arrayContaining([
        "user_1",
        `${getOrganizationMemberSubscriptionReferencePrefix("user_1")}%`,
      ]),
    );
  });
});
