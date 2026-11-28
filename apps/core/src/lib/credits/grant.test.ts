import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  grantFreeCredits: vi.fn(),
  grantSignupBonusCredits: vi.fn(),
  wake: vi.fn(),
}));
vi.mock("@sokosumi/database/helpers", () => ({
  grantFreeCredits: database.grantFreeCredits,
  grantSignupBonusCredits: database.grantSignupBonusCredits,
}));
vi.mock("@/services/task-topup.service", () => ({
  markOutOfCreditsTasksAsToppedUp: database.wake,
}));

import type { NetworkScope } from "@/lib/db/network-scope";

import { grant } from "./grant";

const scope = { network: "mainnet" } as NetworkScope;
const tx = {} as Prisma.TransactionClient;
const signupBonus = {
  scope,
  tx,
  kind: "signup_bonus" as const,
  userId: "user-1",
  credits: 3000,
  expiresAt: null,
};

describe("grant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("wakes nothing for a grant that was already given, even when asked to wake", async () => {
    database.grantSignupBonusCredits.mockResolvedValueOnce({
      bucketId: "bucket-1",
      created: false,
    });

    await expect(grant({ ...signupBonus, wakeTasks: true })).resolves.toEqual({
      outcome: "already_granted",
      bucketId: "bucket-1",
    });
    expect(database.wake).not.toHaveBeenCalled();
  });

  it("wakes the owner's Tasks once after a new grant, on the caller's transaction", async () => {
    database.grantFreeCredits.mockResolvedValueOnce({ bucketId: "bucket-2" });

    await grant({
      scope,
      tx,
      kind: "cmo_tester",
      target: { targetType: "organization", organizationId: "org-1" },
      projectId: "project-1",
      credits: 10,
      expiresAt: null,
      grantId: "grant-1",
      note: null,
      wakeTasks: true,
    });

    expect(database.wake).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org-1",
      projectId: "project-1",
      tx,
      userId: null,
    });
  });

  it("writes nothing for a scope that refuses its Network", async () => {
    const refusal = new Error("Preprod is off");
    const refused = {
      get network(): never {
        throw refusal;
      },
    } as unknown as NetworkScope;

    await expect(
      grant({ ...signupBonus, scope: refused, wakeTasks: true }),
    ).rejects.toBe(refusal);
    expect(database.grantSignupBonusCredits).not.toHaveBeenCalled();
  });
});
