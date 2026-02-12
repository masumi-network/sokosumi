import { TaskEventOrigin, TaskStatus } from "@sokosumi/database";
import { convertCreditsToCents } from "@sokosumi/database/helpers";
import { describe, expect, it } from "vitest";

import type { TaskWithIncludes } from "@/types/task";

import {
  mapTask,
  validateStatusTransition,
  validateTaskCoworkerAssignment,
} from "./task";

const coworkerContext = {
  userId: "user_123",
  organizationId: null,
  coworkerId: "cow_123",
};

const userContext = {
  userId: "user_123",
  organizationId: null,
  coworkerId: null,
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

    it("COMPLETED has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.COMPLETED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
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

    it("CANCELED has no outgoing transitions", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.CANCELED,
          TaskStatus.RUNNING,
        ),
      ).toThrow();
    });

    it("READY → COMPLETED is invalid", () => {
      expect(() =>
        validateStatusTransition(
          coworkerContext,
          TaskStatus.READY,
          TaskStatus.COMPLETED,
        ),
      ).toThrow();
    });
  });

  describe("user allowed transitions", () => {
    it("DRAFT → READY", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.DRAFT,
          TaskStatus.READY,
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

    it("CANCELED → DRAFT", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.CANCELED,
          TaskStatus.DRAFT,
        ),
      ).not.toThrow();
    });

    it("CANCELED → READY", () => {
      expect(() =>
        validateStatusTransition(
          userContext,
          TaskStatus.CANCELED,
          TaskStatus.READY,
        ),
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

  it("allows non-DRAFT tasks with a coworker", () => {
    expect(() =>
      validateTaskCoworkerAssignment({
        status: TaskStatus.READY,
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
  it("aggregates credits from multiple charged events", () => {
    const task = {
      id: "tsk_123",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      userId: "user_123",
      organizationId: null,
      coworkerId: "cow_123",
      name: "Task with retries",
      description: null,
      status: TaskStatus.COMPLETED,
      jobs: [],
      events: [
        {
          id: "evt_cancel",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          status: TaskStatus.CANCELED,
          comment: null,
          authenticationUrl: null,
          origin: TaskEventOrigin.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_cancel",
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
          origin: TaskEventOrigin.SOKOSUMI,
          userId: "user_123",
          coworkerId: null,
          transactionId: null,
          transaction: null,
        },
        {
          id: "evt_complete",
          taskId: "tsk_123",
          createdAt: new Date("2026-01-01T00:02:00.000Z"),
          updatedAt: new Date("2026-01-01T00:02:00.000Z"),
          status: TaskStatus.COMPLETED,
          comment: null,
          authenticationUrl: null,
          origin: TaskEventOrigin.SOKOSUMI,
          userId: null,
          coworkerId: "cow_123",
          transactionId: "txn_complete",
          transaction: {
            amount: convertCreditsToCents(3) * -1n,
          },
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
});
