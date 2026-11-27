import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNetworkScope } from "@/lib/db/network-scope";

const { taskFindUnique, coworkerFindUnique } = vi.hoisted(() => ({
  taskFindUnique: vi.fn(),
  coworkerFindUnique: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    task: { findUnique: taskFindUnique },
    coworker: { findUnique: coworkerFindUnique },
  },
}));

import {
  decisionProposalTargets,
  describeDecision,
  parseDecisionProposal,
} from "./decision-proposal";

const scope = createNetworkScope("mainnet");
const PROJECT = "01960001-0001-7001-8001-0000000000a1";
const UPDATED_AT = "2026-10-15T10:00:00.000Z";
const PARENT_TASK = "01960001-0001-7001-8001-0000000000b1";
const SIBLING_TASK = "01960001-0001-7001-8001-0000000000b2";

beforeEach(() => {
  taskFindUnique.mockReset();
  coworkerFindUnique.mockReset();
});

describe("parseDecisionProposal", () => {
  it("parses a proposal with its tool's schema", () => {
    expect(
      parseDecisionProposal("assign_task", { taskId: "t1", coworkerId: "c1" }),
    ).toEqual({ taskId: "t1", coworkerId: "c1", ready: true });
  });

  it("refuses a proposal its tool's schema does not accept", () => {
    expect(() =>
      parseDecisionProposal("archive_task", { taskId: "t1", extra: true }),
    ).toThrow();
  });
});

describe("describeDecision", () => {
  it("names the Task and Coworker of an assignment", async () => {
    taskFindUnique.mockResolvedValue({ name: " Write the spec " });
    coworkerFindUnique.mockResolvedValue({ name: "Ada" });

    await expect(
      describeDecision(scope, "assign_task", {
        taskId: "t1",
        coworkerId: "c1",
      }),
    ).resolves.toBe(
      'Assign Task "Write the spec" to Coworker "Ada" and start it',
    );
  });

  it("falls back to ids when a name does not resolve", async () => {
    taskFindUnique.mockResolvedValue(null);
    coworkerFindUnique.mockResolvedValue({ name: "  " });

    await expect(
      describeDecision(scope, "assign_task", {
        taskId: "t1",
        coworkerId: "c1",
        ready: false,
      }),
    ).resolves.toBe("Assign Task t1 to Coworker c1");
  });

  it("names the Task an archive targets", async () => {
    taskFindUnique.mockResolvedValue({ name: "Old work" });

    await expect(
      describeDecision(scope, "archive_task", {
        taskId: "t1",
        expectedUpdatedAt: UPDATED_AT,
      }),
    ).resolves.toBe('Archive Task "Old work"');
  });

  it("falls back to the plain reason when a lookup fails", async () => {
    taskFindUnique.mockRejectedValue(new Error("db down"));

    await expect(
      describeDecision(scope, "update_task", { taskId: "t1", name: "B" }),
    ).resolves.toBe("Update Task t1");
  });

  it("describes a proposal with no lookup from its input", async () => {
    await expect(
      describeDecision(scope, "create_task", { name: "A", status: "DRAFT" }),
    ).resolves.toBe("Create DRAFT Task");
    expect(taskFindUnique).not.toHaveBeenCalled();
  });
});

describe("decisionProposalTargets", () => {
  it("names what each proposal writes to", () => {
    expect(
      decisionProposalTargets("create_task", { name: "A", status: "DRAFT" }),
    ).toEqual({
      taskIds: [undefined, undefined, undefined],
      projectIds: [null],
    });
    // A sub-task lands in its parent's Project: the parent and the sibling
    // are the targets a shared bot's scope must reach (SOKD-279).
    expect(
      decisionProposalTargets("create_task", {
        name: "Step",
        parentTaskId: PARENT_TASK,
        afterTaskId: SIBLING_TASK,
      }),
    ).toEqual({
      taskIds: [undefined, PARENT_TASK, SIBLING_TASK],
      projectIds: [],
    });
    expect(
      decisionProposalTargets("update_task", { taskId: "t1", name: "B" }),
    ).toEqual({ taskIds: ["t1"], projectIds: [] });
    expect(
      decisionProposalTargets("update_task", { taskId: "t1", projectId: null }),
    ).toEqual({ taskIds: ["t1"], projectIds: [null] });
    expect(
      decisionProposalTargets("archive_task", {
        taskId: "t1",
        expectedUpdatedAt: UPDATED_AT,
      }),
    ).toEqual({ taskIds: ["t1"] });
    expect(
      decisionProposalTargets("assign_task", {
        taskId: "t1",
        coworkerId: "c1",
      }),
    ).toEqual({ taskIds: ["t1"] });
    expect(
      decisionProposalTargets("provide_job_input", {
        jobId: "j1",
        eventId: "e1",
        inputData: {},
      }),
    ).toEqual({ jobId: "j1" });
  });

  it("keeps a hire without a Project in scope and names a hire's Project", () => {
    const hire = {
      agentId: "a1",
      inputSchema: [],
      inputData: {},
      maxCredits: 5,
    };
    expect(decisionProposalTargets("hire_agent", hire)).toEqual({
      projectIds: [],
    });
    expect(
      decisionProposalTargets("hire_agent", { ...hire, projectId: PROJECT }),
    ).toEqual({ projectIds: [PROJECT] });
  });
});
