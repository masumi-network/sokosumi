import type { Prisma } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";

const {
  projectFindFirstMock,
  slotFindManyMock,
  slotDeleteManyMock,
  slotCreateManyMock,
  socialPostFindManyMock,
  scheduleSocialPostMock,
  getSocialPostMock,
  transactionMock,
} = vi.hoisted(() => ({
  projectFindFirstMock: vi.fn(),
  slotFindManyMock: vi.fn(),
  slotDeleteManyMock: vi.fn(),
  slotCreateManyMock: vi.fn(),
  socialPostFindManyMock: vi.fn(),
  scheduleSocialPostMock: vi.fn(),
  getSocialPostMock: vi.fn(),
  transactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    project: { findFirst: projectFindFirstMock },
    projectSocialQueueSlot: {
      findMany: slotFindManyMock,
      deleteMany: slotDeleteManyMock,
      createMany: slotCreateManyMock,
    },
    socialPost: { findMany: socialPostFindManyMock },
  },
}));

vi.mock("@/services/social-posts.service", () => ({
  scheduleSocialPost: scheduleSocialPostMock,
  getSocialPost: getSocialPostMock,
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const POST_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "user_123";
const CONNECTION_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-09-15T10:00:00.000Z");

const morning = {
  id: "55555555-5555-4555-8555-555555555555",
  name: "Tuesday morning",
  weekday: 2,
  minutesFromMidnight: 11 * 60,
  timezone: "UTC",
};

async function loadService() {
  return import("./social-queue.service");
}

describe("social queue service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    projectFindFirstMock.mockResolvedValue({ id: PROJECT_ID });
    slotFindManyMock.mockResolvedValue([morning]);
    slotDeleteManyMock.mockResolvedValue({ count: 1 });
    slotCreateManyMock.mockResolvedValue({ count: 1 });
    socialPostFindManyMock.mockResolvedValue([]);
    getSocialPostMock.mockResolvedValue({
      socialConnection: { id: CONNECTION_ID },
    });
    transactionMock.mockImplementation(
      (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(prisma),
    );
    scheduleSocialPostMock.mockResolvedValue({
      id: POST_ID,
      status: "SCHEDULED",
    });
  });

  afterEach(() => vi.useRealTimers());

  it("lists slots ordered by weekday and time", async () => {
    const { listSocialQueueSlots } = await loadService();
    const result = await listSocialQueueSlots({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
    });
    expect(result).toEqual({
      timezone: "UTC",
      slots: [
        {
          id: morning.id,
          name: "Tuesday morning",
          weekday: 2,
          minutesFromMidnight: 660,
          timezone: "UTC",
        },
      ],
    });
  });

  it("replaces slots for the project", async () => {
    const { replaceSocialQueueSlots } = await loadService();
    slotFindManyMock.mockResolvedValue([
      { ...morning, name: "Wed 09:00", weekday: 3, minutesFromMidnight: 540 },
    ]);

    const result = await replaceSocialQueueSlots({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      timezone: "Europe/Zurich",
      slots: [{ name: "Wed 09:00", weekday: 3, minutesFromMidnight: 540 }],
    });

    expect(slotDeleteManyMock).toHaveBeenCalledWith({
      where: { projectId: PROJECT_ID },
    });
    expect(slotCreateManyMock).toHaveBeenCalledWith({
      data: [
        {
          projectId: PROJECT_ID,
          name: "Wed 09:00",
          weekday: 3,
          minutesFromMidnight: 540,
          timezone: "Europe/Zurich",
        },
      ],
    });
    expect(result.slots[0]?.name).toBe("Wed 09:00");
  });

  it("rejects queueing when no slots exist", async () => {
    slotFindManyMock.mockResolvedValue([]);
    const { resolveNextSocialQueueSlot } = await loadService();
    await expect(
      resolveNextSocialQueueSlot({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        socialConnectionId: CONNECTION_ID,
      }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Add at least one queue time",
    });
  });

  it("queues a draft in the next free slot", async () => {
    const { queueSocialPost } = await loadService();
    await queueSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
    });
    expect(scheduleSocialPostMock).toHaveBeenCalledWith(
      expect.objectContaining({
        postId: POST_ID,
        scheduledAt: new Date("2026-09-15T11:00:00.000Z"),
        timezone: "UTC",
        revision: 0,
      }),
      expect.anything(),
    );
  });

  it("skips an occupied slot", async () => {
    socialPostFindManyMock.mockResolvedValue([
      { scheduledAt: new Date("2026-09-15T11:00:00.000Z") },
    ]);
    slotFindManyMock.mockResolvedValue([
      morning,
      {
        ...morning,
        id: "66666666-6666-4666-8666-666666666666",
        weekday: 3,
        minutesFromMidnight: 9 * 60,
        name: "Wed 09:00",
      },
    ]);
    const { resolveNextSocialQueueSlot } = await loadService();
    const next = await resolveNextSocialQueueSlot({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      socialConnectionId: CONNECTION_ID,
    });
    expect(next.scheduledAt.toISOString()).toBe("2026-09-16T09:00:00.000Z");
  });

  it("selects and schedules within the same serializable transaction", async () => {
    const { queueSocialPost } = await loadService();
    await queueSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
    });
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(socialPostFindManyMock).toHaveBeenCalledWith({
      where: {
        projectId: PROJECT_ID,
        socialConnectionId: CONNECTION_ID,
        status: { in: ["SCHEDULED", "NEEDS_APPROVAL", "PUBLISHING"] },
        scheduledAt: {
          gte: NOW,
          lte: new Date(NOW.getTime() + 12 * 7 * 24 * 60 * 60 * 1000),
        },
      },
      select: { scheduledAt: true },
    });
    expect(scheduleSocialPostMock).toHaveBeenCalledWith(
      expect.anything(),
      prisma,
    );
  });

  it("checks occupancy on a newly selected connection", async () => {
    const { queueSocialPost } = await loadService();
    await queueSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
      socialConnectionId: "other-connection",
    });
    expect(socialPostFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          socialConnectionId: "other-connection",
        }),
      }),
    );
  });

  it("reselects after a concurrent queue writer takes the first slot", async () => {
    const { queueSocialPost } = await loadService();
    // The database rolls back the losing serializable transaction with P2034.
    transactionMock.mockImplementationOnce(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        await callback(prisma);
        socialPostFindManyMock.mockResolvedValue([
          { scheduledAt: new Date("2026-09-15T11:00:00Z") },
        ]);
        throw { code: "P2034" };
      },
    );
    const queued = queueSocialPost({
      projectId: PROJECT_ID,
      workspaceId: WORKSPACE_ID,
      userId: USER_ID,
      postId: POST_ID,
      revision: 0,
    });
    await vi.runAllTimersAsync();
    await queued;
    expect(transactionMock).toHaveBeenCalledTimes(2);
    expect(scheduleSocialPostMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        scheduledAt: new Date("2026-09-22T11:00:00Z"),
      }),
      prisma,
    );
  });

  it("leaves replacement atomic when inserting new times fails", async () => {
    slotCreateManyMock.mockRejectedValue(new Error("insert failed"));
    const { replaceSocialQueueSlots } = await loadService();
    await expect(
      replaceSocialQueueSlots({
        projectId: PROJECT_ID,
        workspaceId: WORKSPACE_ID,
        timezone: "UTC",
        slots: [{ name: "Morning", weekday: 2, minutesFromMidnight: 660 }],
      }),
    ).rejects.toThrow("insert failed");
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });
});
