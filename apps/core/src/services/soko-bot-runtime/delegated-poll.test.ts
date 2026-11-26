import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  turn: vi.fn(),
  delegation: vi.fn(),
  task: vi.fn(),
  taskEvent: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: db.turn },
    sokoBotDelegation: { findFirst: db.delegation },
    task: { findUnique: db.task },
    taskEvent: { findFirst: db.taskEvent },
    sokoBotToolCall: { findFirst: db.read },
  },
}));

import { computeJobStatus } from "@sokosumi/database/helpers";
import { repeatedPollRefusal } from "./delegated-poll";

const PLAN = "Draft the post from the research, for the owner's approval.";
const changed = new Date("2026-11-26T03:00:00Z");

describe("repeatedPollRefusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A background run of the owner's chat handed a Coworker the research.
    db.turn.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === "run"
        ? { parentTurnId: "owner-chat" }
        : { parentTurnId: null },
    );
    db.delegation.mockResolvedValue({ followUp: PLAN });
    db.task.mockResolvedValue({ status: "RUNNING" });
    db.taskEvent.mockResolvedValue({
      id: "event-running",
      createdAt: changed,
      status: "RUNNING",
    });
    db.read.mockResolvedValue(null);
  });

  const poll = () =>
    repeatedPollRefusal("run", { kind: "TASK", taskId: "task-research" });

  it("lets the first read through", async () => {
    await expect(poll()).resolves.toBeNull();
    expect(db.delegation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskId: "task-research",
          turnId: { in: ["run", "owner-chat"] },
          followUp: { not: null },
          followUpTurnId: null,
        }),
      }),
    );
  });

  it("refuses a second read of running work that has not changed", async () => {
    db.read.mockResolvedValue({ id: "earlier-read" });
    const refusal = await poll();
    expect(refusal).toContain("still running and has not changed");
    expect(refusal).toContain(PLAN);
    // Other independent steps go on; only this check stops.
    expect(refusal).toContain("finish any other step you can do now");
    expect(db.read).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          turnId: "run",
          capability: "get_task_status",
          input: { path: ["taskId"], equals: "task-research" },
          // When the read started, not when it was saved.
          createdAt: { gt: changed },
          // And it returned that latest event.
          result: {
            path: ["events"],
            array_contains: [{ id: "event-running" }],
          },
        }),
      }),
    );
  });

  it.each(["COMPLETED", "FAILED", "INPUT_REQUIRED"])(
    "never refuses a read once the Task is %s",
    async (status) => {
      // The run may have used up the wake on its earlier read.
      db.task.mockResolvedValue({ status });
      db.taskEvent.mockResolvedValue({ createdAt: changed, status: null });
      db.read.mockResolvedValue({ id: "earlier-read" });
      await expect(poll()).resolves.toBeNull();
    },
  );

  it("lets a read through after the Task changed", async () => {
    // The only earlier read started before the latest event.
    db.read.mockResolvedValue(null);
    await expect(poll()).resolves.toBeNull();
  });

  it("finds the request a few runs up", async () => {
    db.turn.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        ({
          "nested-run": { parentTurnId: "run" },
          run: { parentTurnId: "owner-chat" },
        })[where.id] ?? { parentTurnId: null },
    );
    await repeatedPollRefusal("nested-run", {
      kind: "TASK",
      taskId: "task-research",
    });
    expect(db.delegation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          turnId: { in: ["nested-run", "run", "owner-chat"] },
        }),
      }),
    );
  });

  it("leaves reads alone when no follow-up waits on the work", async () => {
    db.delegation.mockResolvedValue(null);
    db.read.mockResolvedValue({ id: "earlier-read" });
    await expect(poll()).resolves.toBeNull();
    expect(db.read).not.toHaveBeenCalled();
  });

  describe("a hired Agent's Job", () => {
    const job = (status: string) =>
      repeatedPollRefusal("run", {
        kind: "JOB",
        jobId: "job-1",
        status,
        changedAt: changed,
      });

    beforeEach(() => {
      db.read.mockResolvedValue({ id: "earlier-read" });
    });

    it("refuses a repeat read while the Agent still works", async () => {
      await expect(job("processing")).resolves.toContain(
        "This Job is still running",
      );
      // A Job's digest carries no event ids: its read is judged by time only.
      expect(db.read.mock.calls.at(-1)![0].where).toMatchObject({
        capability: "get_job_status",
        createdAt: { gt: changed },
      });
      expect(db.read.mock.calls.at(-1)![0].where).not.toHaveProperty("result");
    });

    it.each([
      "completed",
      "failed",
      "input_required",
      "payment_failed",
      "refund_resolved",
    ])("never refuses a read once the Job is %s", async (status) => {
      await expect(job(status)).resolves.toBeNull();
    });

    describe("at its payment deadline", () => {
      afterEach(() => vi.useRealTimers());

      it("lets the bot read the failure that came without a new event", async () => {
        // A paid Job with no purchase: payment_pending until payByTime plus
        // the grace period, then payment_failed, with no JobEvent between.
        const start = new Date("2026-11-26T05:00:00Z");
        const paid = {
          jobType: "PAID",
          refundedTransactionId: null,
          payByTime: new Date(start.getTime() + 60 * 1_000),
          submitResultTime: null,
          externalDisputeUnlockTime: null,
          purchase: null,
          nextAction: "NONE",
          events: [],
        } as never;
        vi.useFakeTimers();
        vi.setSystemTime(start);
        const before = computeJobStatus(paid);
        expect(before).toBe("payment_pending");
        await expect(job(before)).resolves.toContain("still running");

        vi.setSystemTime(new Date(start.getTime() + 60 * 60 * 1_000));
        const after = computeJobStatus(paid);
        expect(after).toBe("payment_failed");
        await expect(job(after)).resolves.toBeNull();
      });
    });
  });
});
