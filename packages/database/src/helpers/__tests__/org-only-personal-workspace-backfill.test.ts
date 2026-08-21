import assert from "node:assert/strict";
import { beforeEach, describe, it, vi } from "vitest";

const ensurePersonalWorkspaceKeepingPreferredMock = vi.hoisted(() => vi.fn());

vi.mock("../../repositories/workspace.repository.js", () => ({
  workspaceRepository: {
    ensurePersonalWorkspaceKeepingPreferred: (...args: unknown[]) =>
      ensurePersonalWorkspaceKeepingPreferredMock(...args),
  },
}));

import {
  backfillPersonalWorkspacesForOrgOnlyUsers,
  type OrgOnlyPersonalWorkspaceBackfillDb,
} from "../org-only-personal-workspace-backfill.js";

describe("backfillPersonalWorkspacesForOrgOnlyUsers", () => {
  const findManyMock = vi.fn();
  const userUpdateMock = vi.fn();
  const tx = {
    user: { update: userUpdateMock },
  };
  const prisma = {
    user: { findMany: findManyMock },
    $transaction: async (callback: (client: typeof tx) => unknown) =>
      callback(tx),
  } as unknown as OrgOnlyPersonalWorkspaceBackfillDb;

  beforeEach(() => {
    findManyMock.mockReset();
    userUpdateMock.mockReset();
    ensurePersonalWorkspaceKeepingPreferredMock.mockReset();
    ensurePersonalWorkspaceKeepingPreferredMock.mockResolvedValue({
      created: true,
      workspace: { id: "ws-1" },
    });
  });

  it("creates personal workspaces for org-only users without clearing preferred org", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "user-org-only",
        preferredOrganizationId: "org-pref",
        members: [{ organizationId: "org-pref" }],
      },
    ]);

    const result = await backfillPersonalWorkspacesForOrgOnlyUsers(prisma);

    assert.deepEqual(findManyMock.mock.calls[0]?.[0], {
      where: {
        members: { some: {} },
        workspace: null,
      },
      select: {
        id: true,
        preferredOrganizationId: true,
        members: {
          select: { organizationId: true },
          take: 1,
          orderBy: { createdAt: "asc" },
        },
      },
    });
    assert.equal(result.created, 1);
    assert.equal(result.considered, 1);
    assert.deepEqual(
      ensurePersonalWorkspaceKeepingPreferredMock.mock.calls[0]?.[0],
      {
        userId: "user-org-only",
        tx,
      },
    );
    assert.equal(userUpdateMock.mock.calls.length, 0);
  });

  it("sets preferred org when it was null so session stays in the organization", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "user-null-pref",
        preferredOrganizationId: null,
        members: [{ organizationId: "org-1" }],
      },
    ]);

    await backfillPersonalWorkspacesForOrgOnlyUsers(prisma);

    assert.deepEqual(userUpdateMock.mock.calls[0]?.[0], {
      where: { id: "user-null-pref" },
      data: { preferredOrganizationId: "org-1" },
    });
  });

  it("skips users with no organization membership", async () => {
    findManyMock.mockResolvedValue([]);

    const result = await backfillPersonalWorkspacesForOrgOnlyUsers(prisma);

    assert.equal(result.created, 0);
    assert.equal(result.considered, 0);
    assert.equal(
      ensurePersonalWorkspaceKeepingPreferredMock.mock.calls.length,
      0,
    );
  });

  it("counts existing personal workspaces as already present", async () => {
    findManyMock.mockResolvedValue([
      {
        id: "user-race",
        preferredOrganizationId: "org-1",
        members: [{ organizationId: "org-1" }],
      },
    ]);
    ensurePersonalWorkspaceKeepingPreferredMock.mockResolvedValue({
      created: false,
      workspace: { id: "ws-existing" },
    });

    const result = await backfillPersonalWorkspacesForOrgOnlyUsers(prisma);

    assert.equal(result.created, 0);
    assert.equal(result.considered, 1);
  });
});
