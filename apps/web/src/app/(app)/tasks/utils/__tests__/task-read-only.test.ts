import { describe, expect, it } from "vitest";

import { isReadOnlyForViewer } from "../task-read-only";

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
});
