import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  captureExceptionMock,
  grantSignupBonusCreditsMock,
  markOutOfCreditsTasksAsToppedUpMock,
  tx,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  grantSignupBonusCreditsMock: vi.fn(),
  markOutOfCreditsTasksAsToppedUpMock: vi.fn(),
  tx: {
    user: { update: vi.fn() },
    workspace: { create: vi.fn(), findUnique: vi.fn() },
  },
}));

vi.mock("@sentry/node", () => ({ captureException: captureExceptionMock }));

vi.mock("@/config/env", () => ({
  getEnv: () => ({ SIGNUP_BONUS_CREDITS: 3000, SIGNUP_BONUS_TTL_DAYS: 30 }),
}));

vi.mock("@sokosumi/database/helpers", () => ({
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

describe("createPersonalWorkspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.workspace.findUnique.mockResolvedValue(null);
    tx.workspace.create.mockResolvedValue({ id: "ws_1", userId: "user_1" });
    grantSignupBonusCreditsMock.mockResolvedValue({
      bucketId: "bucket_1",
      created: true,
    });
  });

  it("grants the signup bonus to the user with the personal workspace", async () => {
    await createPersonalWorkspace("user_1");

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

  it("does not top up tasks when the bonus was already granted", async () => {
    grantSignupBonusCreditsMock.mockResolvedValueOnce({
      bucketId: "bucket_1",
      created: false,
    });

    await createPersonalWorkspace("user_1");

    expect(markOutOfCreditsTasksAsToppedUpMock).not.toHaveBeenCalled();
  });

  it("still returns the workspace when the bonus grant fails", async () => {
    grantSignupBonusCreditsMock.mockRejectedValueOnce(
      new Error("bonus failed"),
    );

    await expect(createPersonalWorkspace("user_1")).resolves.toEqual({
      id: "ws_1",
      userId: "user_1",
    });
    expect(captureExceptionMock).toHaveBeenCalled();
  });

  it("grants nothing when the personal workspace already exists", async () => {
    tx.workspace.findUnique.mockResolvedValueOnce({ id: "ws_0" });

    await expect(createPersonalWorkspace("user_1")).rejects.toThrow(
      "Personal workspace already exists",
    );
    expect(grantSignupBonusCreditsMock).not.toHaveBeenCalled();
  });
});
