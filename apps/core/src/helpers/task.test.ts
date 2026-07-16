import { Channel, GrantResumeStatus } from "@sokosumi/database";
import { convertCreditsToCents, TaskStatus } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";
import type { AuthenticationContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";
import type { TaskWithIncludes } from "@/types/task";

import {
  mapTask,
  validateStatusTransition,
  validateTaskCoworkerAssignment,
} from "./task";

const coworkerContext: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
};

const delegatedCoworkerContext: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_123",
  vendorId: TEST_VENDOR_ID,
  context: {
    userId: "user_123",
    organizationId: null,
  },
};

const userContext: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const defaultTaskUser = {
  id: "user_123",
  name: "Test User",
  image: null,
};

const defaultTaskCoworker = {
  id: "cow_123",
  name: "Test Coworker",
  image: null,
  slug: "test-coworker",
};

const defaultNestedJobUserOrg = {
  user: defaultTaskUser,
  organization: null as { id: string; name: string; slug: string } | null,
};

describe("validateStatusTransition", () => {
  it("rejects same-status transition", () => {
    expect(() => {
      validateStatusTransition(
        coworkerContext,
        TaskStatus.RUNNING,
        TaskStatus.RUNNING,
      );
    }).toThrow("Invalid status transition: same status");
  });

  describe("coworker allowed transitions", () => {
    it.each([
      [TaskStatus.READY, TaskStatus.QUEUED],
      [TaskStatus.QUEUED, TaskStatus.RUNNING],
      [TaskStatus.QUEUED, TaskStatus.DRAFT],
      [TaskStatus.QUEUED, TaskStatus.READY],
    ])("accepts %s → %s", (from, to) => {
      expect(() =>
        validateStatusTransition(coworkerContext, from, to),
      ).not.toThrow();
    });

    it("READY → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.READY,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("READY → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.READY,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("READY → CANCELED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.READY,
          TaskStatus.CANCELED,
        ),
      ).not.toThrow();
    });

    it("READY → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.READY,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → CANCELED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.CANCELED,
        ),
      ).not.toThrow();
    });

    it("INPUT_REQUIRED → APPROVAL_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.APPROVAL_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → INPUT_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.INPUT_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });

    it("AUTHENTICATION_REQUIRED → CANCELED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.CANCELED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → INPUT_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.INPUT_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → COMPLETED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.COMPLETED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → FAILED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.FAILED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → CANCELED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.CANCELED,
        ),
      ).not.toThrow();
    });

    it("RUNNING → AWAITING_EXTERNAL", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.RUNNING,
          TaskStatus.AWAITING_EXTERNAL,
        ),
      ).not.toThrow();
    });

    it("AWAITING_EXTERNAL → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.AWAITING_EXTERNAL,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("CREDITS_TOPPED_UP → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.CREDITS_TOPPED_UP,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("CANCEL_REQUESTED → CANCELED", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.CANCEL_REQUESTED,
          TaskStatus.CANCELED,
        ),
      ).not.toThrow();
    });

    it.each([
      [TaskStatus.READY, TaskStatus.AWAITING_EXTERNAL],
      [TaskStatus.READY, TaskStatus.INPUT_REQUIRED],
      [TaskStatus.READY, TaskStatus.FAILED],
      [TaskStatus.INPUT_REQUIRED, TaskStatus.AWAITING_EXTERNAL],
      [TaskStatus.AUTHENTICATION_REQUIRED, TaskStatus.AWAITING_EXTERNAL],
      [TaskStatus.OUT_OF_CREDITS, TaskStatus.CANCELED],
      [TaskStatus.OUT_OF_CREDITS, TaskStatus.FAILED],
      [TaskStatus.OUT_OF_CREDITS, TaskStatus.COMPLETED],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.AWAITING_EXTERNAL],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.INPUT_REQUIRED],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.AUTHENTICATION_REQUIRED],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.COMPLETED],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.FAILED],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.CANCELED],
      [TaskStatus.AWAITING_EXTERNAL, TaskStatus.INPUT_REQUIRED],
      [TaskStatus.AWAITING_EXTERNAL, TaskStatus.AUTHENTICATION_REQUIRED],
      [TaskStatus.AWAITING_EXTERNAL, TaskStatus.COMPLETED],
      [TaskStatus.AWAITING_EXTERNAL, TaskStatus.FAILED],
      [TaskStatus.AWAITING_EXTERNAL, TaskStatus.CANCELED],
    ])("accepts %s → %s", (from, to) => {
      expect(() =>
        validateStatusTransition(coworkerContext, from, to),
      ).not.toThrow();
    });
  });

  describe("coworker disallowed transitions", () => {
    it("DRAFT has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.DRAFT,
          TaskStatus.READY,
        ),
      ).toThrow();
    });

    it("COMPLETED → RUNNING (agent reopen)", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.COMPLETED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("CANCELED → RUNNING (agent reopen)", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.CANCELED,
          TaskStatus.RUNNING,
        ),
      ).not.toThrow();
    });

    it("FAILED has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.FAILED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("CANCELED → RUNNING is invalid for users", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.CANCELED,
          TaskStatus.RUNNING,
        ),
      ).toThrow(/Invalid status transition/);
    });

    it("COMPLETED → RUNNING is invalid for users", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.COMPLETED,
          TaskStatus.RUNNING,
        ),
      ).toThrow(/Invalid status transition/);
    });

    it("OUT_OF_CREDITS → CREDITS_TOPPED_UP is invalid for coworkers", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.OUT_OF_CREDITS,
          TaskStatus.CREDITS_TOPPED_UP,
        ),
      ).toThrow();
    });

    it("OUT_OF_CREDITS → OUT_OF_CREDITS is invalid for coworkers", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.OUT_OF_CREDITS,
          TaskStatus.OUT_OF_CREDITS,
        ),
      ).toThrow("Invalid status transition: same status");
    });

    it.each([
      [TaskStatus.READY, TaskStatus.OUT_OF_CREDITS],
      [TaskStatus.INPUT_REQUIRED, TaskStatus.OUT_OF_CREDITS],
      [TaskStatus.APPROVAL_REQUIRED, TaskStatus.OUT_OF_CREDITS],
      [TaskStatus.AUTHENTICATION_REQUIRED, TaskStatus.OUT_OF_CREDITS],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.OUT_OF_CREDITS],
      [TaskStatus.RUNNING, TaskStatus.OUT_OF_CREDITS],
      [TaskStatus.AWAITING_EXTERNAL, TaskStatus.OUT_OF_CREDITS],
      [TaskStatus.CANCEL_REQUESTED, TaskStatus.OUT_OF_CREDITS],
    ])("rejects manual %s → OUT_OF_CREDITS", (from, to) => {
      expect(() =>
        validateStatusTransition(coworkerContext, from, to),
      ).toThrow();
    });

    it("CANCEL_REQUESTED → RUNNING is invalid for coworkers", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.CANCEL_REQUESTED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("QUEUED → COMPLETED is invalid for coworkers", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.QUEUED,
          TaskStatus.COMPLETED,
        ),
      ).toThrow();
    });
  });

  describe("user allowed transitions", () => {
    it.each([
      [TaskStatus.DRAFT, TaskStatus.QUEUED],
      [TaskStatus.READY, TaskStatus.QUEUED],
      [TaskStatus.QUEUED, TaskStatus.DRAFT],
      [TaskStatus.QUEUED, TaskStatus.READY],
    ])("accepts %s → %s", (from, to) => {
      expect(() =>
        validateStatusTransition(userContext, from, to),
      ).not.toThrow();
    });

    it("DRAFT → READY", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.DRAFT,
          TaskStatus.READY,
        ),
      ).not.toThrow();
    });

    it("DRAFT → CANCELED", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.DRAFT,
          TaskStatus.CANCELED,
        ),
      ).not.toThrow();
    });

    it("READY → DRAFT", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.DRAFT,
        ),
      ).not.toThrow();
    });

    it("READY → CANCELED", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.CANCELED,
        ),
      ).not.toThrow();
    });

    it("rejects CANCELED → DRAFT (terminal)", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.CANCELED,
          TaskStatus.DRAFT,
        ),
      ).toThrow(/Invalid status transition/);
    });

    it("CANCELED → READY (user reopen)", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.CANCELED,
          TaskStatus.READY,
        ),
      ).not.toThrow();
    });

    it("COMPLETED → READY (user reopen)", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.COMPLETED,
          TaskStatus.READY,
        ),
      ).not.toThrow();
    });

    it("COMPLETED → READY for delegated coworker user-context", () => {
      expect(() =>
        validateStatusTransition(
          delegatedCoworkerContext,
          TaskStatus.COMPLETED,
          TaskStatus.READY,
        ),
      ).not.toThrow();
    });

    it("rejects agent COMPLETED → READY", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.COMPLETED,
          TaskStatus.READY,
        ),
      ).toThrow(/Invalid status transition/);
    });

    it("rejects FAILED → READY", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.FAILED,
          TaskStatus.READY,
        ),
      ).toThrow(/Invalid status transition/);
    });

    it("OUT_OF_CREDITS → CREDITS_TOPPED_UP", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.OUT_OF_CREDITS,
          TaskStatus.CREDITS_TOPPED_UP,
        ),
      ).not.toThrow();
    });

    it.each([
      [TaskStatus.RUNNING, TaskStatus.CANCELED],
      [TaskStatus.AWAITING_EXTERNAL, TaskStatus.CANCELED],
      [TaskStatus.INPUT_REQUIRED, TaskStatus.CANCELED],
      [TaskStatus.APPROVAL_REQUIRED, TaskStatus.CANCELED],
      [TaskStatus.AUTHENTICATION_REQUIRED, TaskStatus.CANCELED],
      [TaskStatus.OUT_OF_CREDITS, TaskStatus.CANCELED],
      [TaskStatus.CREDITS_TOPPED_UP, TaskStatus.CANCELED],
    ])("accepts %s → %s (direct cancel)", (from, to) => {
      expect(() =>
        validateStatusTransition(userContext, from, to),
      ).not.toThrow();
    });
  });

  describe("user disallowed transitions", () => {
    it("rejects READY → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("rejects READY → AUTHENTICATION_REQUIRED", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.AUTHENTICATION_REQUIRED,
        ),
      ).toThrow();
    });

    it("rejects AUTHENTICATION_REQUIRED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.AUTHENTICATION_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("rejects INPUT_REQUIRED → any", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.INPUT_REQUIRED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("rejects RUNNING → any", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.RUNNING,
          TaskStatus.COMPLETED,
        ),
      ).toThrow();
    });

    it("rejects READY → OUT_OF_CREDITS", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.READY,
          TaskStatus.OUT_OF_CREDITS,
        ),
      ).toThrow();
    });

    it("rejects CREDITS_TOPPED_UP → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.CREDITS_TOPPED_UP,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("rejects CANCEL_REQUESTED → CANCELED (legacy intermediate)", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.CANCEL_REQUESTED,
          TaskStatus.CANCELED,
        ),
      ).toThrow();
    });

    it("rejects RUNNING → CANCEL_REQUESTED (legacy intermediate)", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.RUNNING,
          TaskStatus.CANCEL_REQUESTED,
        ),
      ).toThrow();
    });

    it("rejects QUEUED → RUNNING", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.QUEUED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });
  });

  describe("delegated coworker acts as the user", () => {
    const delegatedCoworkerContext: AuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
      context: {
        userId: "user_123",
        organizationId: null,
      },
    };

    it("allows a user-side transition (DRAFT → READY)", () => {
      expect(() =>
        validateStatusTransition(
          delegatedCoworkerContext,
          TaskStatus.DRAFT,
          TaskStatus.READY,
        ),
      ).not.toThrow();
    });

    it("allows a user-side queued transition (DRAFT → QUEUED)", () => {
      expect(() =>
        validateStatusTransition(
          delegatedCoworkerContext,
          TaskStatus.DRAFT,
          TaskStatus.QUEUED,
        ),
      ).not.toThrow();
    });

    it("rejects an agent-only transition (READY → RUNNING)", () => {
      expect(() =>
        validateStatusTransition(
          delegatedCoworkerContext,
          TaskStatus.READY,
          TaskStatus.RUNNING,
        ),
      ).toThrow("Invalid status transition from READY to RUNNING");
    });

    it("rejects an agent-only queued transition (QUEUED → RUNNING)", () => {
      expect(() =>
        validateStatusTransition(
          delegatedCoworkerContext,
          TaskStatus.QUEUED,
          TaskStatus.RUNNING,
        ),
      ).toThrow("Invalid status transition from QUEUED to RUNNING");
    });
  });
});

describe("validateTaskCoworkerAssignment", () => {
  it("allows DRAFT tasks without a coworker", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.DRAFT,
        coworkerId: null,
      }),
    ).not.toThrow();
  });

  it("allows CANCELED tasks without a coworker", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.CANCELED,
        coworkerId: null,
      }),
    ).not.toThrow();
  });

  it("allows non-DRAFT tasks with a coworker", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.READY,
        coworkerId: "cow_123",
      }),
    ).not.toThrow();
  });

  it("allows QUEUED tasks with a coworker", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.QUEUED,
        coworkerId: "cow_123",
      }),
    ).not.toThrow();
  });

  it("rejects non-DRAFT tasks without a coworker", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.READY,
        coworkerId: null,
      }),
    ).toThrow();
  });

  it("rejects QUEUED tasks without a coworker", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.QUEUED,
        coworkerId: null,
      }),
    ).toThrow();
  });

  it("allows non-DRAFT tasks with empty coworkerId at invariant layer", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.READY,
        coworkerId: "   ",
      }),
    ).not.toThrow();
  });
});

describe("mapTask", () => {
  it("preserves the raw share relation for schema parsing to shape later", () => {
    const share = {
      id: "share_123",
      token: "public-share-token",
      allowSearchIndexing: true,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      jobId: null,
      taskId: "tsk_123",
    };
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: null,
      user: defaultTaskUser,
      organization: null,
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
      name: "Task with share",
      description: null,
      status: TaskStatus.READY,
      share,
      jobs: [],
      linksFrom: [],
      linksTo: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.share).toEqual(share);
  });

  it("exposes grant fields only while status is GRANT_PENDING", () => {
    const grantId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
    const parkedTask = {
      id: "tsk_parked",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: null,
      user: defaultTaskUser,
      organization: null,
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
      name: "Parked task",
      description: null,
      status: TaskStatus.GRANT_PENDING,
      grantResumeStatus: GrantResumeStatus.READY,
      pendingVendorGrantId: grantId,
      share: null,
      jobs: [],
      linksFrom: [],
      linksTo: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
    } as unknown as TaskWithIncludes;

    const readyTask = {
      ...parkedTask,
      id: "tsk_ready",
      status: TaskStatus.READY,
      grantResumeStatus: GrantResumeStatus.READY,
      pendingVendorGrantId: grantId,
    } as unknown as TaskWithIncludes;

    expect(mapTask(parkedTask)).toMatchObject({
      status: TaskStatus.GRANT_PENDING,
      grantResumeStatus: GrantResumeStatus.READY,
      pendingVendorGrantId: grantId,
    });
    expect(mapTask(readyTask)).toMatchObject({
      status: TaskStatus.READY,
      grantResumeStatus: null,
      pendingVendorGrantId: null,
    });
  });

  it("serializes nested job workspaces", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: null,
      user: defaultTaskUser,
      organization: null,
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
      name: "Task with job",
      description: null,
      status: TaskStatus.READY,
      share: null,
      linksFrom: [],
      linksTo: [],
      events: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      jobs: [
        {
          id: "job_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          agentId: "agent_123",
          userId: "user_123",
          organizationId: null,
          taskId: "tsk_123",
          name: "Job",
          jobType: "FREE",
          completedAt: null,
          result: null,
          resultHash: null,
          workspace: {
            id: "22222222-2222-7222-8222-222222222222",
            organizationId: "org_123",
            organization: {
              id: "org_123",
              name: "Workspace Org",
              slug: "workspace-org",
            },
          },
          purchase: null,
          transaction: null,
          events: [],
          ...defaultNestedJobUserOrg,
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.jobs[0]?.workspace).toEqual({
      id: "22222222-2222-7222-8222-222222222222",
      organizationId: "org_123",
      organization: {
        id: "org_123",
        name: "Workspace Org",
        slug: "workspace-org",
      },
    });
  });

  it("aggregates credits from multiple charged events (historical rows)", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: null,
      user: defaultTaskUser,
      organization: null,
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
      name: "Task with retries",
      description: null,
      status: TaskStatus.COMPLETED,
      share: null,
      jobs: [],
      linksFrom: [],
      linksTo: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      events: [
        {
          id: "evt_cancel",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.CANCELED,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_cancel",
          cents: convertCreditsToCents(2),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: {
            amount: convertCreditsToCents(2) * -1n,
          },
        },
        {
          id: "evt_ready",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:01:00.000Z"),
          status: TaskStatus.READY,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: "user_123",
          coworkerId: null,
          transactionId: null,
          cents: null,
          transaction: null,
          user: defaultTaskUser,
        },
        {
          id: "evt_complete",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:02:00.000Z"),
          updatedAt: new Date("2026-01-01T00:02:00.000Z"),
          status: TaskStatus.COMPLETED,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_complete",
          cents: convertCreditsToCents(3),
          coworker: defaultTaskCoworker,
          transaction: {
            amount: convertCreditsToCents(3) * -1n,
          },
          user: null,
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.credits).toBe(5);
    expect(result.events).toHaveLength(3);
    expect(result.events[0]?.credits).toBe(2);
    expect(result.events[1]?.credits).toBeNull();
    expect(result.events[2]?.credits).toBe(3);
  });

  it("excludes CREDITS_TOPPED_UP event credits from task total", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: null,
      user: defaultTaskUser,
      organization: null,
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
      name: "Task with top-up",
      description: null,
      status: TaskStatus.COMPLETED,
      share: null,
      jobs: [],
      linksFrom: [],
      linksTo: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      events: [
        {
          id: "evt_complete",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.COMPLETED,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_complete",
          cents: convertCreditsToCents(3),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: { amount: convertCreditsToCents(3) * -1n },
        },
        {
          id: "evt_topup",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:01:00.000Z"),
          updatedAt: new Date("2026-01-01T00:01:00.000Z"),
          status: TaskStatus.CREDITS_TOPPED_UP,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: "user_123",
          coworkerId: null,
          transactionId: null,
          cents: convertCreditsToCents(10),
          transaction: null,
          user: defaultTaskUser,
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.credits).toBe(3);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]?.credits).toBe(3);
    expect(result.events[1]?.credits).toBe(10);
  });

  it("aggregates consumed transaction credits for out-of-credits fallback events", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: null,
      user: defaultTaskUser,
      organization: null,
      coworkerId: "cow_123",
      coworker: defaultTaskCoworker,
      name: "Task with partial charge",
      description: null,
      status: TaskStatus.OUT_OF_CREDITS,
      share: null,
      jobs: [],
      linksFrom: [],
      linksTo: [],
      workspace: {
        id: "11111111-1111-7111-8111-111111111111",
        organizationId: null,
        organization: null,
      },
      events: [
        {
          id: "evt_partial",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.OUT_OF_CREDITS,
          comment: null,
          authenticationUrl: null,
          channel: Channel.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_partial",
          cents: convertCreditsToCents(5),
          user: null,
          coworker: defaultTaskCoworker,
          transaction: {
            amount: convertCreditsToCents(2) * -1n,
          },
        },
      ],
    } as unknown as TaskWithIncludes;

    const result = mapTask(task);

    expect(result.credits).toBe(2);
    expect(result.events[0]?.credits).toBe(5);
  });
});
