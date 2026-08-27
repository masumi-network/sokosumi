import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getOrganizationActiveSubscriptionMock,
  getMyActiveSubscriptionMock,
  CoreApiRequestError,
} = vi.hoisted(() => {
  class CoreApiRequestError extends Error {
    status: number;

    constructor(message: string, options: { status: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options.status;
    }
  }

  return {
    getOrganizationActiveSubscriptionMock: vi.fn(),
    getMyActiveSubscriptionMock: vi.fn(),
    CoreApiRequestError,
  };
});

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError,
  coreClientNoRedirect: {
    getOrganizationActiveSubscription: getOrganizationActiveSubscriptionMock,
    getMyActiveSubscription: getMyActiveSubscriptionMock,
  },
}));

vi.mock("@/components/billing/subscription-plan-utils", () => ({
  parsePlanName: (plan: string | null | undefined) => plan ?? null,
}));

import {
  resolveTaskActivityPlan,
  resolveTaskDetailViewerPlan,
} from "@/app/tasks/utils/task-activity-plan";

describe("resolveTaskActivityPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null without calling Core when there is no session", async () => {
    await expect(resolveTaskActivityPlan(null, "org_1")).resolves.toBeNull();
    expect(getOrganizationActiveSubscriptionMock).not.toHaveBeenCalled();
    expect(getMyActiveSubscriptionMock).not.toHaveBeenCalled();
  });

  it("returns null for org membership 403 instead of freefalling to free", async () => {
    getOrganizationActiveSubscriptionMock.mockRejectedValue(
      new CoreApiRequestError("You are not a member of this organization", {
        status: 403,
      }),
    );

    await expect(
      resolveTaskActivityPlan(
        {
          user: { id: "admin_1" },
          session: { id: "sess_1", activeOrganizationId: null },
        } as never,
        "org_other",
      ),
    ).resolves.toBeNull();

    expect(getOrganizationActiveSubscriptionMock).toHaveBeenCalledWith(
      "org_other",
    );
    expect(getMyActiveSubscriptionMock).not.toHaveBeenCalled();
  });

  it("returns null when the organization subscription is not found", async () => {
    getOrganizationActiveSubscriptionMock.mockRejectedValue(
      new CoreApiRequestError("Organization not found", { status: 404 }),
    );

    await expect(
      resolveTaskActivityPlan(
        {
          user: { id: "user_1" },
          session: { id: "sess_1", activeOrganizationId: null },
        } as never,
        "org_missing",
      ),
    ).resolves.toBeNull();
  });

  it("returns free when a member resolves a null subscription", async () => {
    getOrganizationActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: null },
    });

    await expect(
      resolveTaskActivityPlan(
        {
          user: { id: "user_1" },
          session: { id: "sess_1", activeOrganizationId: "org_1" },
        } as never,
        "org_1",
      ),
    ).resolves.toBe("free");
  });

  it("returns the organization plan when the viewer can resolve it", async () => {
    getOrganizationActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "pro" } },
    });

    await expect(
      resolveTaskActivityPlan(
        {
          user: { id: "user_1" },
          session: { id: "sess_1", activeOrganizationId: "org_1" },
        } as never,
        "org_1",
      ),
    ).resolves.toBe("pro");
  });

  it("uses the personal subscription when the task has no organization", async () => {
    getMyActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "starter" } },
    });

    await expect(
      resolveTaskActivityPlan(
        {
          user: { id: "user_1" },
          session: { id: "sess_1", activeOrganizationId: null },
        } as never,
        null,
      ),
    ).resolves.toBe("starter");

    expect(getMyActiveSubscriptionMock).toHaveBeenCalled();
    expect(getOrganizationActiveSubscriptionMock).not.toHaveBeenCalled();
  });
});

describe("resolveTaskDetailViewerPlan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips Core subscription lookup when forceReadOnly is true", async () => {
    await expect(
      resolveTaskDetailViewerPlan(
        true,
        {
          user: { id: "admin_1" },
          session: { id: "sess_1", activeOrganizationId: null },
        } as never,
        "org_other",
      ),
    ).resolves.toBeNull();

    expect(getOrganizationActiveSubscriptionMock).not.toHaveBeenCalled();
    expect(getMyActiveSubscriptionMock).not.toHaveBeenCalled();
  });

  it("delegates to resolveTaskActivityPlan when forceReadOnly is false", async () => {
    getOrganizationActiveSubscriptionMock.mockResolvedValue({
      data: { subscription: { plan: "pro" } },
    });

    await expect(
      resolveTaskDetailViewerPlan(
        false,
        {
          user: { id: "user_1" },
          session: { id: "sess_1", activeOrganizationId: "org_1" },
        } as never,
        "org_1",
      ),
    ).resolves.toBe("pro");

    expect(getOrganizationActiveSubscriptionMock).toHaveBeenCalledWith("org_1");
  });
});
