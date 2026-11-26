import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  turn: vi.fn(),
  delegation: vi.fn(),
  task: vi.fn(),
  taskEvent: vi.fn(),
  jobEvent: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: db.turn },
    sokoBotDelegation: { findFirst: db.delegation },
    task: { findUnique: db.task },
    taskEvent: { findFirst: db.taskEvent },
    jobEvent: { findFirst: db.jobEvent },
    sokoBotToolCall: { findFirst: db.read },
  },
}));

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
    db.taskEvent.mockResolvedValue({ createdAt: changed, status: "RUNNING" });
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

  it("does the same for a hired Agent's Job", async () => {
    db.jobEvent.mockResolvedValue({ createdAt: changed, status: "RUNNING" });
    db.read.mockResolvedValue({ id: "earlier-read" });
    await expect(
      repeatedPollRefusal("run", { kind: "JOB", jobId: "job-1" }),
    ).resolves.toContain("This Job is still running");
    db.jobEvent.mockResolvedValue({
      createdAt: changed,
      status: "AWAITING_INPUT",
    });
    await expect(
      repeatedPollRefusal("run", { kind: "JOB", jobId: "job-1" }),
    ).resolves.toBeNull();
  });
});
