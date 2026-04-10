import { TaskStatus } from "@sokosumi/database";
import { describe, expect, it } from "vitest";

import type {
  CoworkerAuthenticationContext,
  UserAuthenticationContext,
} from "@/middleware/auth";
import type { WorkspaceContext } from "@/middleware/workspace-context";

import { buildVisibleTaskLinksInclude } from "./task-link";

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
};

const organizationWorkspaceContext: WorkspaceContext = {
  workspaceId: "11111111-1111-7111-8111-111111111111",
  userId: null,
  organizationId: "org_123",
};

const personalWorkspaceContext: WorkspaceContext = {
  workspaceId: "22222222-2222-7222-8222-222222222222",
  userId: "user_123",
  organizationId: null,
};

describe("buildVisibleTaskLinksInclude", () => {
  it("constrains org peer tasks to the active workspace", () => {
    expect(
      buildVisibleTaskLinksInclude(
        userAuthContext,
        organizationWorkspaceContext,
      ),
    ).toEqual({
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

  it("keeps personal workspace peer tasks owner-scoped", () => {
    const include = buildVisibleTaskLinksInclude(
      {
        ...userAuthContext,
        organizationId: null,
      },
      personalWorkspaceContext,
    );

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

  it("returns no visible peer tasks when no workspace exists", () => {
    const include = buildVisibleTaskLinksInclude(userAuthContext, null);

    expect(include.linksFrom.where).toEqual({
      toTask: {
        is: {
          workspaceId: "__missing_workspace__",
          userId: "user_123",
        },
      },
    });
    expect(include.linksTo.where).toEqual({
      fromTask: {
        is: {
          workspaceId: "__missing_workspace__",
          userId: "user_123",
        },
      },
    });
  });

  it("keeps coworker peer task visibility unchanged", () => {
    const authContext: CoworkerAuthenticationContext = {
      actor: "coworker",
      coworkerId: "cow_123",
    };

    const include = buildVisibleTaskLinksInclude(authContext, null);

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
  });
});
