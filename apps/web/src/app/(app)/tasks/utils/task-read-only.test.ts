import { describe, expect, it } from "vitest";
import { TaskStatus } from "@/lib/clients/generated/core";

import {
  canArchiveParkedTaskForViewer,
  canCancelTaskForViewer,
  canCommentOnTaskForViewer,
  canManageTaskLifecycleForViewer,
  isReadOnlyForViewer,
} from "./task-read-only";

describe("isReadOnlyForViewer", () => {
  it("forces read-only for admins regardless of ownership", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: null,
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: true,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(true);
  });

  it("keeps the owner of an organization task editable", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: true,
      }),
    ).toBe(false);
  });

  it("defaults to read-only when assigned seat is omitted", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(true);
  });

  it("makes an unseated paid owner read-only", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: false,
      }),
    ).toBe(true);
  });

  it("makes a non-owner collaborator on an organization task read-only", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(true);
  });

  it("keeps the owner of a personal-workspace task editable", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: null,
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: true,
      }),
    ).toBe(false);
  });

  it("treats a non-owner on a personal-workspace task as editable when not forced (unreachable on the user route, but the gate must not over-restrict)", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: null,
        taskOwnerId: "owner_1",
        sessionUserId: "someone_else",
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
        hasAssignedSeat: true,
      }),
    ).toBe(false);
  });

  it("is read-only for an unauthenticated viewer on an organization task", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: null,
        forceReadOnly: false,
        taskStatus: TaskStatus.READY,
      }),
    ).toBe(true);
  });

  it("is read-only while vendor grant approval is pending", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskOwnerId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
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
        isOrgOwnerOrAdmin: false,
      }),
    ).toBe(true);
  });

  it("allows org owner/admin to archive grant-pending tasks they do not own", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: false,
        isOrgOwnerOrAdmin: true,
      }),
    ).toBe(true);
  });

  it("blocks archive for plain members while grant is pending", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: false,
        isOrgOwnerOrAdmin: false,
      }),
    ).toBe(false);
  });

  it("never unlocks archive under forceReadOnly", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: true,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: true,
        isOrgOwnerOrAdmin: true,
      }),
    ).toBe(false);
  });
});

describe("canManageTaskLifecycleForViewer", () => {
  it("hands status, archive, and workspace moves to the series while one is live", () => {
    expect(canManageTaskLifecycleForViewer({ hasActiveSchedule: true })).toBe(
      false,
    );
  });

  it("returns lifecycle control once no series is live", () => {
    expect(canManageTaskLifecycleForViewer({ hasActiveSchedule: false })).toBe(
      true,
    );
  });

  it("keeps parked archive on owner/admin for grant-pending scheduled tasks", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: true,
        isOrgOwnerOrAdmin: false,
      }),
    ).toBe(true);
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        taskStatus: TaskStatus.GRANT_PENDING,
        isTaskOwner: false,
        isOrgOwnerOrAdmin: true,
      }),
    ).toBe(true);
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
