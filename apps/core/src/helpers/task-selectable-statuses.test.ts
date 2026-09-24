import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";
import type { AuthenticationContext } from "@/middleware/auth";

import { getSelectableTaskStatuses } from "./task-selectable-statuses";

const userActor: AuthenticationContext = {
  actor: "user",
  userId: "user_1",
  organizationId: null,
  role: "user",
};

const coworkerActor: AuthenticationContext = {
  actor: "coworker",
  coworkerId: "cow_1",
  vendorId: "vendor_1",
};

const delegatedCoworkerActor: AuthenticationContext = {
  ...coworkerActor,
  context: { userId: "user_1", organizationId: null },
};

function task(
  overrides: Partial<Parameters<typeof getSelectableTaskStatuses>[0]> = {},
) {
  return {
    status: TaskStatus.READY,
    assigneeId: "cow_1",
    assigneeSokoBotId: null,
    runAt: null,
    ...overrides,
  };
}

describe("getSelectableTaskStatuses", () => {
  it("offers a person the hand-set statuses in display order, minus the current one", () => {
    expect(getSelectableTaskStatuses(task(), userActor)).toEqual([
      TaskStatus.DRAFT,
      TaskStatus.RUNNING,
      TaskStatus.AWAITING_EXTERNAL,
      TaskStatus.COMPLETED,
      TaskStatus.CANCELED,
    ]);
  });

  it("never offers a person Input required or Approval required, even with a coworker assignee", () => {
    const selectable = getSelectableTaskStatuses(task(), userActor);
    expect(selectable).not.toContain(TaskStatus.INPUT_REQUIRED);
    expect(selectable).not.toContain(TaskStatus.APPROVAL_REQUIRED);
  });

  it("treats a delegated coworker like a person", () => {
    expect(getSelectableTaskStatuses(task(), delegatedCoworkerActor)).toEqual(
      getSelectableTaskStatuses(task(), userActor),
    );
  });

  it("offers a coworker every status except the current one when the task has a coworker assignee", () => {
    const selectable = getSelectableTaskStatuses(task(), coworkerActor);
    expect(selectable).toContain(TaskStatus.INPUT_REQUIRED);
    expect(selectable).toContain(TaskStatus.APPROVAL_REQUIRED);
    expect(selectable).toContain(TaskStatus.FAILED);
    expect(selectable).not.toContain(TaskStatus.READY);
    expect(selectable).not.toContain(TaskStatus.QUEUED);
  });

  it("withholds agent-only statuses when the task has no coworker or Soko Bot assignee", () => {
    const selectable = getSelectableTaskStatuses(
      task({ assigneeId: null }),
      coworkerActor,
    );
    expect(selectable).toEqual([
      TaskStatus.DRAFT,
      TaskStatus.RUNNING,
      TaskStatus.AWAITING_EXTERNAL,
      TaskStatus.COMPLETED,
      TaskStatus.CANCELED,
    ]);
  });

  it("offers Queued only when the Task has a Run at", () => {
    const runAt = new Date("2026-10-01T09:00:00Z");
    expect(getSelectableTaskStatuses(task(), userActor)).not.toContain(
      TaskStatus.QUEUED,
    );
    expect(
      getSelectableTaskStatuses(
        task({ status: TaskStatus.DRAFT, runAt }),
        userActor,
      ),
    ).toEqual([
      TaskStatus.QUEUED,
      TaskStatus.READY,
      TaskStatus.RUNNING,
      TaskStatus.AWAITING_EXTERNAL,
      TaskStatus.COMPLETED,
      TaskStatus.CANCELED,
    ]);
  });

  it("does not offer Queued with a Run at if nothing is assigned to run it", () => {
    expect(
      getSelectableTaskStatuses(
        task({
          status: TaskStatus.DRAFT,
          assigneeId: null,
          runAt: new Date("2026-10-01T09:00:00Z"),
        }),
        userActor,
      ),
    ).not.toContain(TaskStatus.QUEUED);
  });

  it("lets a person move a Queued Task anywhere a person may", () => {
    expect(
      getSelectableTaskStatuses(
        task({
          status: TaskStatus.QUEUED,
          runAt: new Date("2026-10-01T09:00:00Z"),
        }),
        userActor,
      ),
    ).toEqual([
      TaskStatus.DRAFT,
      TaskStatus.READY,
      TaskStatus.RUNNING,
      TaskStatus.AWAITING_EXTERNAL,
      TaskStatus.COMPLETED,
      TaskStatus.CANCELED,
    ]);
  });
});
