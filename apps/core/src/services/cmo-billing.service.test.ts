import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  cmoUpdate,
  memberFindUnique,
  mockBilling,
  resetCmoServiceMocks,
  strategy,
  subscriptionFindFirst,
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

import { CmoForbiddenError } from "@/services/cmo-cuso.service";
import {
  chooseCmoMockPlan,
  cmoExecutionRefusal,
  hasActiveCmoSubscription,
} from "./cmo-billing.service";

beforeEach(resetCmoServiceMocks);

describe("strategy approval → execution gate", () => {
  const workspace = (approvedAt: Date | null) => ({
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    strategy,
    strategyApprovedAt: approvedAt,
  });

  it("asks the business organization's plan", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue({ plan: "starter" });
    await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" });
    expect(subscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ referenceId: "org-1" }),
      }),
    );
  });

  it("leaves every non-CMO bot alone", async () => {
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "v19" }),
    ).toBeNull();
    expect(cmoFindUnique).not.toHaveBeenCalled();
  });

  it("refuses before the owner approves, even when subscribed", async () => {
    cmoFindUnique.mockResolvedValue(workspace(null));
    subscriptionFindFirst.mockResolvedValue({ plan: "starter" });
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/approved/);
  });

  it("refuses without a subscription after approval", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
  });

  it("executes once approved and subscribed, with no per-post approval", async () => {
    cmoFindUnique.mockResolvedValue(workspace(new Date()));
    subscriptionFindFirst.mockResolvedValue({ plan: "starter" });
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
  });

  it("counts only active paid plans", async () => {
    subscriptionFindFirst.mockResolvedValue(null);
    expect(await hasActiveCmoSubscription("org-1")).toBe(false);
    expect(subscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceId: "org-1",
          status: { in: ["active", "trialing"] },
        }),
      }),
    );
  });
});

describe("mock billing", () => {
  const approvedWithMockPlan = {
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    strategy,
    strategyApprovedAt: new Date(),
    mockPlan: "growth",
  };

  it("lets a mock plan open execution while CMO_MOCK_BILLING is on", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
    expect(subscriptionFindFirst).not.toHaveBeenCalled();
  });

  it("ignores a stored mock plan when the flag is off (production)", async () => {
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
  });

  it("ignores CMO_MOCK_BILLING on production", async () => {
    mockBilling.on = true;
    mockBilling.production = true;
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
    await expect(chooseCmoMockPlan("user-1", "scale")).rejects.toThrow(
      /mock billing is off/i,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("stores the chosen tier only while the flag is on", async () => {
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    await expect(chooseCmoMockPlan("user-1", "scale")).rejects.toThrow(
      /mock billing is off/i,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();

    mockBilling.on = true;
    await chooseCmoMockPlan("user-1", "scale");
    expect(cmoUpdate.mock.calls[0]?.[0].data).toMatchObject({
      mockPlan: "scale",
      mockPlanActivatedAt: expect.any(Date),
    });
  });

  it("starts the paid month for owners and admins only", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approvedWithMockPlan);
    memberFindUnique.mockResolvedValue({ role: "member" });
    await expect(chooseCmoMockPlan("user-2", "scale")).rejects.toBeInstanceOf(
      CmoForbiddenError,
    );
    expect(cmoUpdate).not.toHaveBeenCalled();
  });
});
