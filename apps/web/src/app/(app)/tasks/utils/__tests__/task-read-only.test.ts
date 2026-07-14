import { describe, expect, it } from "vitest";

import {
  canArchiveParkedTaskForViewer,
  canCommentOnTaskForViewer,
  isReadOnlyForViewer,
} from "../task-read-only";

describe("isReadOnlyForViewer", () => {
  it("forces read-only for admins regardless of ownership", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: null,
        taskUserId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: true,
      }),
    ).toBe(true);
  });

  it("keeps the owner of an organization task editable", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskUserId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
      }),
    ).toBe(false);
  });

  it("makes a non-owner collaborator on an organization task read-only", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskUserId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: false,
      }),
    ).toBe(true);
  });

  it("keeps the owner of a personal-workspace task editable", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: null,
        taskUserId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
      }),
    ).toBe(false);
  });

  it("treats a non-owner on a personal-workspace task as editable when not forced (unreachable on the user route, but the gate must not over-restrict)", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: null,
        taskUserId: "owner_1",
        sessionUserId: "someone_else",
        forceReadOnly: false,
      }),
    ).toBe(false);
  });

  it("is read-only for an unauthenticated viewer on an organization task", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskUserId: "owner_1",
        sessionUserId: null,
        forceReadOnly: false,
      }),
    ).toBe(true);
  });

  it("is read-only while vendor grant approval is pending", () => {
    expect(
      isReadOnlyForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskUserId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        pendingApproval: true,
      }),
    ).toBe(true);
  });
});

describe("canArchiveParkedTaskForViewer", () => {
  it("allows the task owner to archive while parked", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        pendingApproval: true,
        isTaskOwner: true,
        isOrgOwnerOrAdmin: false,
      }),
    ).toBe(true);
  });

  it("allows org owner/admin to archive parked tasks they do not own", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        pendingApproval: true,
        isTaskOwner: false,
        isOrgOwnerOrAdmin: true,
      }),
    ).toBe(true);
  });

  it("blocks archive for plain members while parked", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: false,
        pendingApproval: true,
        isTaskOwner: false,
        isOrgOwnerOrAdmin: false,
      }),
    ).toBe(false);
  });

  it("never unlocks archive under forceReadOnly", () => {
    expect(
      canArchiveParkedTaskForViewer({
        forceReadOnly: true,
        pendingApproval: true,
        isTaskOwner: true,
        isOrgOwnerOrAdmin: true,
      }),
    ).toBe(false);
  });
});

describe("canCommentOnTaskForViewer", () => {
  it("allows organization workspace collaborators to comment without ownership", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskUserId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: false,
      }),
    ).toBe(true);
  });

  it("keeps mutation read-only collaborators from commenting when forced read-only", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskUserId: "owner_1",
        sessionUserId: "member_2",
        forceReadOnly: true,
      }),
    ).toBe(false);
  });

  it("does not allow comments for non-owners on personal workspace tasks", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: null,
        taskUserId: "owner_1",
        sessionUserId: "someone_else",
        forceReadOnly: false,
      }),
    ).toBe(false);
  });

  it("blocks comments while vendor grant approval is pending", () => {
    expect(
      canCommentOnTaskForViewer({
        taskWorkspaceOrganizationId: "org_1",
        taskUserId: "owner_1",
        sessionUserId: "owner_1",
        forceReadOnly: false,
        pendingApproval: true,
      }),
    ).toBe(false);
  });
});
