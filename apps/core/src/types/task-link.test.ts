import { TaskStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CoworkerAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";

import { buildVisibleTaskLinksInclude } from "./task-link";

const { resolveWorkspaceForContextMock } = vi.hoisted(() => ({
  resolveWorkspaceForContextMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();

  return {
    ...actual,
    resolveWorkspaceForContext: resolveWorkspaceForContextMock,
  };
});

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
};

describe("buildVisibleTaskLinksInclude", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("constrains org peer tasks to the active workspace", async () => {
    resolveWorkspaceForContextMock.mockResolvedValueOnce({
      id: "11111111-1111-7111-8111-111111111111",
    });

    await expect(
      buildVisibleTaskLinksInclude(userAuthContext),
    ).resolves.toEqual({
      linksFrom: {
        where: {
          toTask: {
            is: {
              workspaceId: "11111111-1111-7111-8111-111111111111",
            },
          },
        },
        include: {
          fromTask: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
          toTask: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
      linksTo: {
        where: {
          fromTask: {
            is: {
              workspaceId: "11111111-1111-7111-8111-111111111111",
            },
          },
        },
        include: {
          fromTask: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
          toTask: {
            select: {
              id: true,
              name: true,
              status: true,
              archivedAt: true,
            },
          },
        },
        orderBy: {
          createdAt: "asc",
        },
      },
    });
  });

  it("keeps personal workspace peer tasks owner-scoped", async () => {
    resolveWorkspaceForContextMock.mockResolvedValueOnce({
      id: "22222222-2222-7222-8222-222222222222",
    });

    const include = await buildVisibleTaskLinksInclude({
      ...userAuthContext,
      organizationId: null,
    });

    expect(include.linksFrom.where).toEqual({
      toTask: {
        is: {
          workspaceId: "22222222-2222-7222-8222-222222222222",
          userId: "user_123",
        },
      },
    });
    expect(include.linksTo.where).toEqual({
      fromTask: {
        is: {
          workspaceId: "22222222-2222-7222-8222-222222222222",
          userId: "user_123",
        },
      },
    });
  });

  it("keeps coworker peer task visibility unchanged", async () => {
    const authContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    const include = await buildVisibleTaskLinksInclude(authContext);

    expect(include.linksFrom.where).toEqual({
      toTask: {
        is: {
          coworkerId: "cow_123",
          archivedAt: null,
          NOT: {
            status: {
              in: [TaskStatus.DRAFT],
            },
          },
        },
      },
    });
    expect(include.linksTo.where).toEqual({
      fromTask: {
        is: {
          coworkerId: "cow_123",
          archivedAt: null,
          NOT: {
            status: {
              in: [TaskStatus.DRAFT],
            },
          },
        },
      },
    });
    expect(resolveWorkspaceForContextMock).not.toHaveBeenCalled();
  });
});
