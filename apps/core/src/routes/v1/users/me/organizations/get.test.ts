import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Prisma } from "@sokosumi/database";

import { attachCreditsToOrganizations } from "@/helpers/credits";

describe("attachCreditsToOrganizations", () => {
  it("uses a single raw query for multiple orgs", async () => {
    const members = [
      {
        organization: { id: "org-1", name: "Org 1" },
        role: "member",
      },
      {
        organization: { id: "org-2", name: "Org 2" },
        role: "admin",
      },
    ];

    let calls = 0;
    const tx = {
      $queryRaw: async () => {
        calls += 1;
        return [{ organization_id: "org-1", balance: 2_000_000_000_000n }];
      },
    } as unknown as Prisma.TransactionClient;

    const result = await attachCreditsToOrganizations(members, tx);

    assert.equal(calls, 1);
    assert.equal(result.length, 2);
    assert.equal(result[0]?.credits, 2);
    assert.equal(result[1]?.credits, 0);
  });

  it("returns empty array without querying when no members", async () => {
    const tx = {
      $queryRaw: async () => {
        throw new Error("Unexpected $queryRaw call");
      },
    } as unknown as Prisma.TransactionClient;

    const result = await attachCreditsToOrganizations([], tx);

    assert.deepEqual(result, []);
  });
});
