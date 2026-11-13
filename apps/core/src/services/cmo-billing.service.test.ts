import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  creditBucketFindFirst,
  creditBucketFindMany,
  cusoFind,
  envOverrides,
  polarSubscriptionFindFirst,
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

import {
  cmoExecutionRefusal,
  maySkipCmoSubscription,
  readCmoBilling,
} from "./cmo-billing.service";

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

  it("refuses once approved while the Project has no paid CMO plan", async () => {
    cusoFind.mockResolvedValue(workspace(new Date()));
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribes to CMO/);
  });

  it("executes once approved and subscribed, with no per-post approval", async () => {
    cusoFind.mockResolvedValue(workspace(new Date()));
    polarSubscriptionFindFirst.mockResolvedValue({ id: "subscription-1" });
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

  it("has no plan and owes the checkout for a Cuso without Tester credits", async () => {
    expect(await readCmoBilling("project-1")).toEqual({
      tier: null,
      interval: null,
      status: null,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      pendingTier: null,
      hasTesterCredits: false,
    });
    expect(polarSubscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { projectId: "project-1", endedAt: null },
      }),
    );
    expect(listPolarProducts).not.toHaveBeenCalled();
  });

  it("reads the plan from the Project's subscription that has not ended", async () => {
    polarSubscriptionFindFirst.mockResolvedValue({
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
      hasTesterCredits: false,
    });
  });

  it("names the tier a scheduled downgrade moves to", async () => {
    polarSubscriptionFindFirst.mockResolvedValue({
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

  it("knows a Cuso with Tester credits, spent or not", async () => {
    creditBucketFindFirst.mockResolvedValueOnce({ id: "bucket-1" });
    expect((await readCmoBilling("project-1")).hasTesterCredits).toBe(true);
    expect(creditBucketFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { referenceType: "CMO_TESTER_CREDITS", projectId: "project-1" },
      }),
    );
  });
});

describe("maySkipCmoSubscription", () => {
  /** 10^10 ledger units are one credit. */
  const CREDIT = 10_000_000_000n;

  beforeEach(() => {
    // The fixture's person is lena@harborbikes.com.
    envOverrides.CMO_SUBSCRIPTION_SKIP_ALLOWLIST = ["@harborbikes.com"];
  });

  it("lets a tester skip while nothing pays for the Cuso", async () => {
    expect(await maySkipCmoSubscription("user-1", "project-1")).toBe(true);
  });

  it("refuses a person who is not on the list, and everyone while it is empty", async () => {
    envOverrides.CMO_SUBSCRIPTION_SKIP_ALLOWLIST = ["@acme.io"];
    expect(await maySkipCmoSubscription("user-1", "project-1")).toBe(false);
    envOverrides.CMO_SUBSCRIPTION_SKIP_ALLOWLIST = [];
    expect(await maySkipCmoSubscription("user-1", "project-1")).toBe(false);
  });

  it("refuses while an active subscription pays for him", async () => {
    polarSubscriptionFindFirst.mockResolvedValue({ id: "sub-1" });
    expect(await maySkipCmoSubscription("user-1", "project-1")).toBe(false);
  });

  it("refuses while Tester credits are left, and allows it once they are spent", async () => {
    creditBucketFindMany.mockResolvedValue([
      { amount: 10_000n * CREDIT, consumptions: [{ amount: 4_000n * CREDIT }] },
    ]);
    expect(await maySkipCmoSubscription("user-1", "project-1")).toBe(false);
    creditBucketFindMany.mockResolvedValue([
      {
        amount: 10_000n * CREDIT,
        consumptions: [{ amount: 10_000n * CREDIT }],
      },
    ]);
    expect(await maySkipCmoSubscription("user-1", "project-1")).toBe(true);
  });
});
