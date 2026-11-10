import { beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

/**
 * Two businesses the caller markets, each with its own Cuso, plus one they do
 * not belong to and a Project of theirs without a Cuso. org-1 is preferred.
 */
const world = vi.hoisted(() => {
  const projects: Record<string, { organizationId: string }> = {
    "aaaaaaaa-aaaa-4aaa-8aaa-000000000001": { organizationId: "org-1" },
    "aaaaaaaa-aaaa-4aaa-8aaa-000000000002": { organizationId: "org-2" },
    "aaaaaaaa-aaaa-4aaa-8aaa-000000000003": { organizationId: "org-3" },
    "aaaaaaaa-aaaa-4aaa-8aaa-000000000004": { organizationId: "org-1" },
  };
  const bots: Record<string, string> = {
    "aaaaaaaa-aaaa-4aaa-8aaa-000000000001": "bot-1",
    "aaaaaaaa-aaaa-4aaa-8aaa-000000000002": "bot-2",
    "aaaaaaaa-aaaa-4aaa-8aaa-000000000003": "bot-3",
  };
  return { projects, bots, memberships: new Set<string>() };
});

function botRow(projectId: string) {
  const project = world.projects[projectId];
  const id = world.bots[projectId];
  if (!project || !id) return null;
  return {
    id,
    createdAt: new Date("2026-10-01T09:00:00Z"),
    project: {
      id: projectId,
      workspaceId: `ws-${project.organizationId}`,
      websiteUrl: `https://${projectId}.example`,
      workspace: { organizationId: project.organizationId },
      brandBrain: null,
    },
  };
}

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: {
      findUnique: async () => ({ preferredOrganizationId: "org-1" }),
    },
    project: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        const project = world.projects[where.id];
        return project
          ? {
              id: where.id,
              workspaceId: `ws-${project.organizationId}`,
              workspace: {
                userId: null,
                organizationId: project.organizationId,
              },
            }
          : null;
      },
    },
    member: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organizationId: string };
      }) =>
        world.memberships.has(`${where.userId}:${where.organizationId}`)
          ? { id: "member" }
          : null,
    },
    sokoBot: {
      findFirst: async ({ where }: { where: { projectId?: string } }) =>
        where.projectId ? botRow(where.projectId) : null,
      // The Cusos of every organization the caller belongs to, newest first.
      findMany: async () =>
        Object.keys(world.bots)
          .map(botRow)
          .filter(
            (row) =>
              row &&
              world.memberships.has(
                `user-1:${row.project.workspace.organizationId}`,
              ),
          ),
    },
    marketingStrategy: {
      findFirst: async ({ where }: { where: { projectId: string } }) => ({
        id: `strategy-of-${where.projectId}`,
      }),
    },
  },
}));

vi.mock(
  "@/services/marketing-strategy-files.service",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("@/services/marketing-strategy-files.service")
      >();
    return {
      ...actual,
      readMarketingPieceText: async (
        version: { id: string },
        entryId: string,
      ) => `${entryId} of ${version.id}`,
    };
  },
);

import cmoRouter from "./index";

const PREFERRED = "aaaaaaaa-aaaa-4aaa-8aaa-000000000001";
const OTHER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000002";
const STRANGER = "aaaaaaaa-aaaa-4aaa-8aaa-000000000003";
const NO_CUSO = "aaaaaaaa-aaaa-4aaa-8aaa-000000000004";
const UNKNOWN = "aaaaaaaa-aaaa-4aaa-8aaa-000000000009";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user-1",
      organizationId: null,
      role: "user",
      authenticationMethod: "oauth",
    });
    return await next();
  });
  app.route("/", cmoRouter);
  return app;
}

async function readPiece(path: string) {
  const response = await createApp().request(path);
  const body = await response.text();
  return {
    status: response.status,
    body: response.ok ? JSON.parse(body) : body,
  };
}

describe("CMO routes naming a Cuso by his Project", () => {
  beforeEach(() => {
    world.memberships.clear();
    world.memberships.add("user-1:org-1");
    world.memberships.add("user-1:org-2");
  });

  it("reaches the named Project's Cuso, not the preferred organization's", async () => {
    const { status, body } = await readPiece(
      `/projects/${OTHER}/calendar/article/text`,
    );
    expect(status).toBe(200);
    expect(body.data.text).toBe(`article of strategy-of-${OTHER}`);
  });

  it("answers 404 for a Project of an organization the caller is not in", async () => {
    const { status } = await readPiece(
      `/projects/${STRANGER}/calendar/article/text`,
    );
    expect(status).toBe(404);
  });

  it("answers 404 once the caller left the Project's organization", async () => {
    world.memberships.delete("user-1:org-2");
    const { status } = await readPiece(
      `/projects/${OTHER}/calendar/article/text`,
    );
    expect(status).toBe(404);
  });

  it("answers a Project the caller may not see like one that does not exist", async () => {
    const stranger = await readPiece(
      `/projects/${STRANGER}/calendar/article/text`,
    );
    const unknown = await readPiece(
      `/projects/${UNKNOWN}/calendar/article/text`,
    );
    expect(stranger).toEqual(unknown);
  });

  it("answers 404 for a Project without a Cuso", async () => {
    const { status } = await readPiece(
      `/projects/${NO_CUSO}/calendar/article/text`,
    );
    expect(status).toBe(404);
  });

  it("keeps acting on the preferred organization's Cuso without a Project", async () => {
    const { status, body } = await readPiece("/calendar/article/text");
    expect(status).toBe(200);
    expect(body.data.text).toBe(`article of strategy-of-${PREFERRED}`);
  });

  const ID = "aaaaaaaa-aaaa-4aaa-8aaa-0000000000ff";
  const RETURN_URL = { returnUrl: "https://cmo.xyz/back" };
  // Every CMO route that acts on a Cuso, after `/projects/{projectId}`.
  it.each([
    ["GET", "", undefined],
    ["POST", "/onboarding/retry", undefined],
    ["POST", "/start-over", undefined],
    ["POST", "/strategy", {}],
    ["POST", "/strategy/ads", { monthly: 100, currency: "EUR" }],
    ["POST", "/strategy/answers/apply", undefined],
    ["POST", "/calendar/article/pause", undefined],
    ["GET", "/calendar/article/text", undefined],
    ["POST", `/updates/${ID}/revert`, undefined],
    ["POST", "/measurement/google_analytics/connect", RETURN_URL],
    ["POST", "/measurement/google_analytics/finalize", undefined],
    ["POST", "/ads/google_ads/connect", RETURN_URL],
    ["POST", "/ads/finalize", { connectionId: "c", sessionUri: null }],
    ["GET", `/ads/connections/${ID}/choices`, undefined],
    ["POST", "/ads/accounts", { adConnectionId: ID, externalAccountId: "1" }],
    ["GET", "/ads/campaigns", undefined],
    ["POST", "/ads/launch", { entryId: "article" }],
    [
      "POST",
      "/ads/campaigns/status",
      { accountId: ID, campaignId: "1", status: "PAUSED" },
    ],
  ])(
    "%s %s answers 404 for a stranger's Project",
    async (method, path, body) => {
      const response = await createApp().request(
        `/projects/${STRANGER}${path}`,
        {
          method,
          ...(body
            ? {
                headers: { "content-type": "application/json" },
                body: JSON.stringify(body),
              }
            : {}),
        },
      );
      expect(response.status).toBe(404);
      // The access check refused it, not a route that does not exist.
      expect(await response.text()).toBe("Project not found");
    },
  );
});
