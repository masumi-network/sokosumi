import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectFindFirstMock, projectFindUniqueMock, memberFindFirstMock } =
  vi.hoisted(() => ({
    projectFindFirstMock: vi.fn(),
    projectFindUniqueMock: vi.fn(),
    memberFindFirstMock: vi.fn(),
  }));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: {
      findFirst: projectFindFirstMock,
      findUnique: projectFindUniqueMock,
    },
    member: { findFirst: memberFindFirstMock },
  },
}));

import { HTTPException } from "hono/http-exception";

import {
  requireProjectAccess,
  requireProjectAccessForUser,
} from "@/lib/image-studio/access";

const ORG_PROJECT = {
  id: "project-1",
  workspaceId: "workspace-1",
  workspace: { userId: null, organizationId: "org-1" },
};

const PERSONAL_PROJECT = {
  id: "project-2",
  workspaceId: "workspace-2",
  workspace: { userId: "user-1", organizationId: null },
};

async function expectNotFound(work: Promise<unknown>) {
  await expect(work).rejects.toMatchObject({ status: 404 });
  await work.catch((error) => {
    expect(error).toBeInstanceOf(HTTPException);
  });
}

describe("image studio project access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows a current member of the owning organization", async () => {
    projectFindFirstMock.mockResolvedValue(ORG_PROJECT);
    memberFindFirstMock.mockResolvedValue({ id: "member-1" });

    await expect(
      requireProjectAccess({
        projectId: "project-1",
        workspaceId: "workspace-1",
        userId: "user-1",
      }),
    ).resolves.toEqual({
      projectId: "project-1",
      workspaceId: "workspace-1",
      userId: "user-1",
    });
  });

  it("refuses a user whose membership was revoked, even with a matching workspace", async () => {
    // This is the case workspace scoping alone does not catch: the session
    // still resolves the same workspace id, but the membership row is gone.
    projectFindFirstMock.mockResolvedValue(ORG_PROJECT);
    memberFindFirstMock.mockResolvedValue(null);

    await expectNotFound(
      requireProjectAccess({
        projectId: "project-1",
        workspaceId: "workspace-1",
        userId: "removed-user",
      }),
    );
  });

  it("refuses a project in another workspace", async () => {
    projectFindFirstMock.mockResolvedValue(null);

    await expectNotFound(
      requireProjectAccess({
        projectId: "project-1",
        workspaceId: "other-workspace",
        userId: "user-1",
      }),
    );
    // Never reached the membership read: the scoped project query already
    // answered, and answering 404 means existence is not disclosed either.
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("allows the owner of a personal workspace without a membership row", async () => {
    projectFindFirstMock.mockResolvedValue(PERSONAL_PROJECT);

    await expect(
      requireProjectAccess({
        projectId: "project-2",
        workspaceId: "workspace-2",
        userId: "user-1",
      }),
    ).resolves.toMatchObject({ projectId: "project-2" });
    expect(memberFindFirstMock).not.toHaveBeenCalled();
  });

  it("refuses another user's personal workspace", async () => {
    projectFindFirstMock.mockResolvedValue(PERSONAL_PROJECT);

    await expectNotFound(
      requireProjectAccess({
        projectId: "project-2",
        workspaceId: "workspace-2",
        userId: "someone-else",
      }),
    );
  });

  describe("without a workspace context (the agent path)", () => {
    it("resolves the workspace from the project and proves membership", async () => {
      projectFindUniqueMock.mockResolvedValue(ORG_PROJECT);
      memberFindFirstMock.mockResolvedValue({ id: "member-1" });

      await expect(
        requireProjectAccessForUser({
          projectId: "project-1",
          userId: "user-1",
        }),
      ).resolves.toEqual({
        projectId: "project-1",
        workspaceId: "workspace-1",
        userId: "user-1",
      });
    });

    it("refuses a grant replayed after the user lost access", async () => {
      projectFindUniqueMock.mockResolvedValue(ORG_PROJECT);
      memberFindFirstMock.mockResolvedValue(null);

      await expectNotFound(
        requireProjectAccessForUser({
          projectId: "project-1",
          userId: "removed-user",
        }),
      );
    });
  });
});
