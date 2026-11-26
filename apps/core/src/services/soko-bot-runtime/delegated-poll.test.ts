import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  turn: vi.fn(),
  delegation: vi.fn(),
  taskEvent: vi.fn(),
  jobEvent: vi.fn(),
  read: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: db.turn },
    sokoBotDelegation: { findFirst: db.delegation },
    taskEvent: { findFirst: db.taskEvent },
    jobEvent: { findFirst: db.jobEvent },
    sokoBotToolCall: { findFirst: db.read },
  },
}));

import { repeatedPollRefusal } from "./delegated-poll";

const PLAN = "Draft the LinkedIn post from Mira's numbers with a chart.";
const changed = new Date("2026-11-26T03:00:00Z");

describe("repeatedPollRefusal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // A background run of the owner's chat handed Mira the research.
    db.turn.mockResolvedValue({ parentTurnId: "owner-chat" });
    db.delegation.mockResolvedValue({ followUp: PLAN });
    db.taskEvent.mockResolvedValue({ createdAt: changed });
    db.read.mockResolvedValue(null);
  });

  const poll = () =>
    repeatedPollRefusal("run", { kind: "TASK", taskId: "task-mira" });

  it("lets the first read through", async () => {
    await expect(poll()).resolves.toBeNull();
    expect(db.delegation).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          taskId: "task-mira",
          turnId: { in: ["run", "owner-chat"] },
          followUp: { not: null },
          followUpTurnId: null,
        }),
      }),
    );
  });

  it("refuses a second read when nothing changed, and says the wake is coming", async () => {
    db.read.mockResolvedValue({ id: "earlier-read" });
    const refusal = await poll();
    expect(refusal).toContain("has not changed since you last read it");
    expect(refusal).toContain(PLAN);
    expect(refusal).toContain("end this turn now");
    expect(db.read).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          turnId: "run",
          capability: "get_task_status",
          input: { path: ["taskId"], equals: "task-mira" },
          updatedAt: { gte: changed },
        }),
      }),
    );
  });

  it("lets a read through after the Task changed", async () => {
    // The only earlier read was before Mira's latest event.
    db.read.mockResolvedValue(null);
    await expect(poll()).resolves.toBeNull();
  });

  it("leaves reads alone when no follow-up waits on the work", async () => {
    db.delegation.mockResolvedValue(null);
    db.read.mockResolvedValue({ id: "earlier-read" });
    await expect(poll()).resolves.toBeNull();
    expect(db.read).not.toHaveBeenCalled();
  });

  it("does the same for a hired Agent's Job", async () => {
    db.jobEvent.mockResolvedValue({ createdAt: changed });
    db.read.mockResolvedValue({ id: "earlier-read" });
    await expect(
      repeatedPollRefusal("run", { kind: "JOB", jobId: "job-1" }),
    ).resolves.toContain("This Job has not changed");
    expect(db.read).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          capability: "get_job_status",
          input: { path: ["jobId"], equals: "job-1" },
        }),
      }),
    );
  });
});
