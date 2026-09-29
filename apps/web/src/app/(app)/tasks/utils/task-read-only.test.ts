import { TaskStatus } from "@sokosumi/core-client";
import { describe, expect, it } from "vitest";

import {
  canArchiveParkedTaskForViewer,
  canCancelTaskForViewer,
  canCommentOnTaskForViewer,
  isReadOnlyForViewer,
} from "./task-read-only";

describe("isReadOnlyForViewer", () => {
  it("forces read-only for admins", () => {
    expect(
      isReadOnlyForViewer({
        forceReadOnly: true,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: true,
      }),
    ).toBe(true);
  });

  it("keeps any seated viewer editable, owner or not", () => {
    expect(
      isReadOnlyForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: true,
      }),
    ).toBe(false);
  });

  it("defaults to read-only when assigned seat is omitted", () => {
    expect(
      isReadOnlyForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(true);
  });

  it("makes an unseated viewer read-only", () => {
    expect(
      isReadOnlyForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: false,
      }),
    ).toBe(true);
  });

  it("is read-only while vendor grant approval is pending", () => {
    expect(
      isReadOnlyForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        hasAssignedSeat: true,
      }),
    ).toBe(true);
  });
});

describe("canArchiveParkedTaskForViewer", () => {
  it("allows the task owner to archive while grant is pending", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: true,
        isOrganizationTask: false,
        hasAssignedSeat: true,
      }),
    ).toBe(true);
  });

  it("allows any member to archive a grant-pending organization task they do not own", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: false,
        isOrganizationTask: true,
        hasAssignedSeat: true,
      }),
    ).toBe(true);
  });

  it("blocks archive for a non-owner of a personal task while grant is pending", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: false,
        isOrganizationTask: false,
        hasAssignedSeat: true,
      }),
    ).toBe(false);
  });

  it("blocks archive for an unseated member who does not own the task", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: false,
        isOrganizationTask: true,
        hasAssignedSeat: false,
      }),
    ).toBe(false);
  });

  it("never unlocks archive under forceReadOnly", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: true,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: true,
        isOrganizationTask: true,
        hasAssignedSeat: true,
      }),
    ).toBe(false);
  });
});

describe("canCommentOnTaskForViewer", () => {
  it("allows organization workspace collaborators to comment without ownership", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: true,
      }),
    ).toBe(true);
  });

  it("blocks comments when assigned seat is omitted", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(false);
  });

  it("keeps mutation read-only collaborators from commenting when forced read-only", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: true,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(false);
  });

  it("does not allow comments for non-owners on personal workspace tasks", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: null,
        taskOwnerId: "owner_1",
        sessionUserId: "someone_else",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(false);
  });

  it("blocks comments when the viewer has no assigned seat", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: false,
      }),
    ).toBe(false);
  });

  it("blocks comments while vendor grant approval is pending", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
      }),
    ).toBe(false);
  });
});

describe("canCancelTaskForViewer", () => {
  it("allows organization workspace collaborators to cancel without ownership", () => {
    expect(
      canCancelTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: false,
        taskStatus: TaskStatus.RUNNING,
      }),
    ).toBe(true);
  });

  it("allows the task owner to cancel", () => {
    expect(
      canCancelTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.RUNNING,
      }),
    ).toBe(true);
  });

  it("blocks cancel when forced read-only", () => {
    expect(
      canCancelTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: true,
        taskStatus: TaskStatus.RUNNING,
      }),
    ).toBe(false);
  });

  it("does not allow cancel for non-owners on personal workspace tasks", () => {
    expect(
      canCancelTaskForViewer({
        taskWorkspaceOrganizationId: null,
        taskOwnerId: "owner_1",
        sessionUserId: "someone_else",
        forceReadOnly: false,
        taskStatus: TaskStatus.RUNNING,
      }),
    ).toBe(false);
  });

  it("blocks cancel while vendor grant approval is pending", () => {
    expect(
      canCancelTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
      }),
    ).toBe(false);
  });
});
