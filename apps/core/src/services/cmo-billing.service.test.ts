import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoSubscriptionFindFirst,
  creditBucketFindFirst,
  cusoFind,
  resetCmoServiceMocks,
  seedStrategy,
  strategy,
} from "@/test-fixtures/cmo-service";

vi.mock(
  "@/lib/db/prisma",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.prisma,
);
vi.mock(
  "@/services/social-posts.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.socialPosts,
);
vi.mock(
  "@/services/free-credit-admin.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.freeCredits,
);
vi.mock(
  "@/services/soko-bot-shared-create.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.sharedCreate,
);
vi.mock(
  "@/services/soko-bot-control-plane.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.controlPlane,
);
vi.mock(
  "@/helpers/organization-workspace",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .organizationWorkspace,
);
vi.mock(
  "@/helpers/user-workspaces",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .userWorkspaces,
);
vi.mock(
  "@/helpers/subscription",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.subscription,
);
vi.mock(
  "@/services/soko-bot-billing.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.billing,
);
vi.mock(
  "@vercel/functions",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .vercelFunctions,
);
vi.mock(
  "@/services/soko-bot-integration-connection.service",
  async () =>
    (await import("@/test-fixtures/cmo-service")).cmoServiceMocks
      .integrationConnection,
);
vi.mock("@/config/env", async (importOriginal) =>
  (await import("@/test-fixtures/cmo-service")).cmoServiceMocks.env(
    await importOriginal<typeof import("@/config/env")>(),
  ),
);

const listPolarProducts = vi.hoisted(() => vi.fn());
vi.mock("@/clients/polar.client", () => ({ listPolarProducts }));

import { cmoExecutionRefusal, readCmoBilling } from "./cmo-billing.service";

beforeEach(resetCmoServiceMocks);

describe("strategy approval → execution gate", () => {
  const workspace = (approvedAt: Date | null) => {
    seedStrategy(strategy, { approvedAt });
    return {
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
    };
  };

  it("leaves every non-CMO bot alone", async () => {
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "v19" }),
    ).toBeNull();
    expect(cusoFind).not.toHaveBeenCalled();
  });

  it("refuses before the owner approves", async () => {
    cusoFind.mockResolvedValue(workspace(null));
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/approved/);
  });

  it("executes once approved, with no plan and no per-post approval", async () => {
    cusoFind.mockResolvedValue(workspace(new Date()));
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
  });
});

describe("readCmoBilling", () => {
  const PERIOD_END = new Date("2026-12-13T10:00:00.000Z");
  const row = {
    polarProductId: "prod_growth_month",
    tier: "growth",
    interval: "month",
    status: "active",
    currentPeriodEnd: PERIOD_END,
    cancelAtPeriodEnd: false,
    pendingPolarProductId: null,
  };

  it("has no plan and owes the checkout for a Cuso hired without Starter credits", async () => {
    expect(await readCmoBilling("project-1")).toEqual({
      tier: null,
      interval: null,
      status: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      pendingTier: null,
      hiredWithStarterCredits: false,
    });
    expect(cmoSubscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", endedAt: null },
      }),
    );
    expect(listPolarProducts).not.toHaveBeenCalled();
  });

  it("reads the plan from the Project's subscription that has not ended", async () => {
    cmoSubscriptionFindFirst.mockResolvedValue({
      ...row,
      interval: "year",
      status: "past_due",
      cancelAtPeriodEnd: true,
    });
    expect(await readCmoBilling("project-1")).toEqual({
      tier: "growth",
      interval: "year",
      status: "past_due",
      periodEnd: PERIOD_END,
      cancelAtPeriodEnd: true,
      pendingTier: null,
      hiredWithStarterCredits: false,
    });
  });

  it("names the tier a scheduled downgrade moves to", async () => {
    cmoSubscriptionFindFirst.mockResolvedValue({
      ...row,
      pendingPolarProductId: "prod_starter_month",
    });
    listPolarProducts.mockResolvedValueOnce([
      {
        id: "prod_starter_month",
        name: "Starter",
        metadata: { kind: "plan", tier: "starter", credits: "10000" },
        is_recurring: true,
        recurring_interval: "month",
        recurring_interval_count: 1,
        prices: [
          {
            amount_type: "fixed",
            is_archived: false,
            price_amount: 20000,
            price_currency: "usd",
          },
        ],
      },
    ]);
    expect((await readCmoBilling("project-1")).pendingTier).toBe("starter");
  });

  it("knows a Cuso hired with Starter credits, spent or not", async () => {
    creditBucketFindFirst.mockResolvedValueOnce({ id: "bucket-1" });
    expect((await readCmoBilling("project-1")).hiredWithStarterCredits).toBe(
      true,
    );
    expect(creditBucketFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          referenceType: "FREE",
          referenceNote: "CMO.xyz starter credits (project project-1)",
        },
      }),
    );
  });
});
