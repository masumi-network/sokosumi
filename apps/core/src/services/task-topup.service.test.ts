import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { markOutOfCreditsTasksAsToppedUp } from "./task-topup.service";

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

vi.mock("@/helpers/notification-email-dispatch", () => ({
  cancelNotificationEmails: vi.fn().mockResolvedValue(undefined),
  EMAILED_NOTIFICATION_COLUMNS: { id: true },
}));

function createTx() {
  return {
    task: {
      findMany: vi.fn().mockResolvedValue([{ id: "tsk_1" }]),
      update: vi.fn().mockResolvedValue({ id: "tsk_1" }),
    },
    notification: {
      updateManyAndReturn: vi.fn().mockResolvedValue([]),
    },
  };
}

describe("markOutOfCreditsTasksAsToppedUp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resumes the personal Tasks the topped-up person owns", async () => {
    const tx = createTx();

    await markOutOfCreditsTasksAsToppedUp({
      organizationId: null,
      userId: "user_1",
      tx: tx as never,
    });

    expect(tx.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          ownerId: "user_1",
          status: TaskStatus.OUT_OF_CREDITS,
        },
      }),
    );
    expect(tx.task.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tsk_1", status: TaskStatus.OUT_OF_CREDITS },
        data: expect.objectContaining({
          status: TaskStatus.CREDITS_TOPPED_UP,
        }),
      }),
    );
  });

  it("resumes every out-of-credits Task of an Organization, with or without an Owner", async () => {
    const tx = createTx();

    await markOutOfCreditsTasksAsToppedUp({
      organizationId: "org_1",
      userId: null,
      tx: tx as never,
    });

    expect(tx.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", status: TaskStatus.OUT_OF_CREDITS },
      }),
    );
    expect(tx.task.update).toHaveBeenCalledTimes(1);
  });
});
