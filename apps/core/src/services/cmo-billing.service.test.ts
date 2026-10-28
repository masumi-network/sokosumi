import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cmoFindUnique,
  cmoUpdate,
  memberFindUnique,
  mockBilling,
  resetCmoServiceMocks,
  seedStrategy,
  strategy,
  subscriptionCreate,
  subscriptionFindFirst,
  subscriptionUpdate,
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
  const workspace = (approvedAt: Date | null) => {
    seedStrategy(strategy, { approvedAt });
    return {
      id: "cmo-1",
      userId: "user-1",
      workspaceId: "ws-1",
      projectId: "project-1",
    };
  };

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
  const approved = {
    id: "cmo-1",
    userId: "user-1",
    workspaceId: "ws-1",
    projectId: "project-1",
    mockPlan: "growth",
  };
  beforeEach(() => {
    seedStrategy(strategy, { approvedAt: new Date() });
  });

  it("counts only Subscription rows, never a tier stored on the hire", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue({ ...approved, mockPlan: "growth" });
    subscriptionFindFirst.mockResolvedValue(null);
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toMatch(/subscribe/);
  });

  it("opens execution through the mock plan's Subscription row", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approved);
    subscriptionFindFirst.mockResolvedValue({
      plan: "growth",
      stripeSubscriptionId: null,
    });
    expect(
      await cmoExecutionRefusal({ sokoBotId: "bot-1", versionId: "cmo-v1" }),
    ).toBeNull();
  });

  it("creates an active CMO Subscription without Stripe IDs for the paying organization", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approved);
    subscriptionFindFirst.mockResolvedValue(null);
    await chooseCmoMockPlan("user-1", "growth");
    expect(subscriptionCreate).toHaveBeenCalledWith({
      data: {
        referenceId: "org-1",
        plan: "growth",
        status: "active",
        periodStart: expect.any(Date),
      },
    });
    expect(cmoUpdate).not.toHaveBeenCalled();
  });

  it("moves the organization's mock Subscription to the newly chosen tier", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approved);
    subscriptionFindFirst.mockResolvedValue({ id: "sub-1" });
    await chooseCmoMockPlan("user-1", "scale");
    expect(subscriptionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          referenceId: "org-1",
          stripeSubscriptionId: null,
        }),
      }),
    );
    expect(subscriptionUpdate).toHaveBeenCalledWith({
      where: { id: "sub-1" },
      data: { plan: "scale", status: "active", periodStart: expect.any(Date) },
    });
    expect(subscriptionCreate).not.toHaveBeenCalled();
  });

  it("refuses a tier that is not a CMO plan", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approved);
    await expect(chooseCmoMockPlan("user-1", "enterprise")).rejects.toThrow(
      /not a CMO plan/i,
    );
    expect(subscriptionCreate).not.toHaveBeenCalled();
  });

  it("refuses the mock plan while mock billing is off", async () => {
    cmoFindUnique.mockResolvedValue(approved);
    await expect(chooseCmoMockPlan("user-1", "scale")).rejects.toThrow(
      /mock billing is off/i,
    );
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("ignores CMO_MOCK_BILLING on production", async () => {
    mockBilling.on = true;
    mockBilling.production = true;
    cmoFindUnique.mockResolvedValue(approved);
    await expect(chooseCmoMockPlan("user-1", "scale")).rejects.toThrow(
      /mock billing is off/i,
    );
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });

  it("starts the paid month for owners and admins only", async () => {
    mockBilling.on = true;
    cmoFindUnique.mockResolvedValue(approved);
    memberFindUnique.mockResolvedValue({ role: "member" });
    await expect(chooseCmoMockPlan("user-2", "scale")).rejects.toBeInstanceOf(
      CmoForbiddenError,
    );
    expect(subscriptionCreate).not.toHaveBeenCalled();
    expect(subscriptionUpdate).not.toHaveBeenCalled();
  });
});
