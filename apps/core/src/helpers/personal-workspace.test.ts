import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  ensureInitialLocalFreeSubscriptionPeriodMock,
  grantSignupBonusCreditsMock,
  markOutOfCreditsTasksAsToppedUpMock,
  tx,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  ensureInitialLocalFreeSubscriptionPeriodMock: vi.fn(),
  grantSignupBonusCreditsMock: vi.fn(),
  markOutOfCreditsTasksAsToppedUpMock: vi.fn(),
  tx: {
    $queryRaw: vi.fn(),
    subscription: { findFirst: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    workspace: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@sentry/node", () => ({ captureException: captureExceptionMock }));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ SIGNUP_BONUS_CREDITS: 3000, SIGNUP_BONUS_TTL_DAYS: 30 }),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ACTIVE_SUBSCRIPTION_STATUSES: ["active", "trialing"],
  ensureInitialLocalFreeSubscriptionPeriod:
    ensureInitialLocalFreeSubscriptionPeriodMock,
  FREE_SUBSCRIPTION_PLAN: "free",
  getCreditExpiryDate: (from: Date) => from,
  grantSignupBonusCredits: grantSignupBonusCreditsMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  vendorGrantRepository: { ensureServiceplanWorkspaceGrantOnCreate: vi.fn() },
  workspaceRepository: { seedCuratedVocabulary: vi.fn() },
}));

vi.mock("@/services/task-topup.service", () => ({
  markOutOfCreditsTasksAsToppedUp: markOutOfCreditsTasksAsToppedUpMock,
}));

vi.mock("@/helpers/workspace-access", () => ({ isLastWorkspace: vi.fn() }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

import { createPersonalWorkspace } from "./personal-workspace";

const workspaceCreatedAt = new Date("2026-11-11T12:00:00.000Z");

describe("createPersonalWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.workspace.findUnique.mockResolvedValue(null);
    tx.workspace.create.mockResolvedValue({
      createdAt: workspaceCreatedAt,
      id: "ws_1",
      userId: "user_1",
    });
    tx.subscription.findFirst.mockResolvedValue(null);
    tx.$queryRaw.mockResolvedValue([{ stripeCustomerId: "cus_1" }]);
    ensureInitialLocalFreeSubscriptionPeriodMock.mockResolvedValue({
      grantsCreated: 1,
    });
    grantSignupBonusCreditsMock.mockResolvedValue({
      bucketId: "bucket_1",
      created: true,
    });
  });

  it("starts the free plan and grants the signup bonus with the workspace", async () => {
    await createPersonalWorkspace("user_1");

    expect(ensureInitialLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        createdAt: workspaceCreatedAt,
        kind: "user",
        stripeCustomerId: "cus_1",
        userId: "user_1",
      },
      tx,
    );
    expect(grantSignupBonusCreditsMock).toHaveBeenCalledWith(
      expect.objectContaining({ credits: 3000, userId: "user_1" }),
      tx,
    );
    expect(markOutOfCreditsTasksAsToppedUpMock).toHaveBeenCalledWith({
      organizationId: null,
      tx,
      userId: "user_1",
    });
  });

  it("keeps an existing active free plan instead of starting a second one", async () => {
    tx.subscription.findFirst.mockResolvedValueOnce({ id: "sub_1" });

    await createPersonalWorkspace("user_1");

    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(grantSignupBonusCreditsMock).toHaveBeenCalled();
  });

  it("checks for an active plan after acquiring the user lock", async () => {
    let releaseLock!: () => void;
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const lockRequested = new Promise<void>((resolve) => {
      tx.$queryRaw.mockImplementationOnce(async () => {
        resolve();
        await lock;
        return [{ stripeCustomerId: "cus_1" }];
      });
    });

    const creation = createPersonalWorkspace("user_1");
    await Promise.race([lockRequested, creation]);
    expect(tx.subscription.findFirst).not.toHaveBeenCalled();

    tx.subscription.findFirst.mockResolvedValueOnce({ id: "sub_1" });
    releaseLock();
    await creation;

    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
  });

  it("does not top up tasks when nothing new was granted", async () => {
    tx.subscription.findFirst.mockResolvedValueOnce({ id: "sub_1" });
    grantSignupBonusCreditsMock.mockResolvedValueOnce({
      bucketId: "bucket_1",
      created: false,
    });

    await createPersonalWorkspace("user_1");

    expect(markOutOfCreditsTasksAsToppedUpMock).not.toHaveBeenCalled();
  });

  it("still returns the workspace when the grant fails", async () => {
    grantSignupBonusCreditsMock.mockRejectedValueOnce(
      new Error("bonus failed"),
    );

    await expect(createPersonalWorkspace("user_1")).resolves.toMatchObject({
      id: "ws_1",
    });
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("grants nothing when the personal workspace already exists", async () => {
    tx.workspace.findUnique.mockResolvedValueOnce({ id: "ws_0" });

    await expect(createPersonalWorkspace("user_1")).rejects.toThrow(
      "Personal workspace already exists",
    );
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
    expect(grantSignupBonusCreditsMock).not.toHaveBeenCalled();
  });
});
