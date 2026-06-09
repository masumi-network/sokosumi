import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatZodErrorMessage, unprocessableEntity } from "@/helpers/error";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

import mountGetHiredAgents from "./get";

const {
  agentFindManyMock,
  buildAgentSummariesMock,
  buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrowMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  agentFindManyMock: vi.fn(),
  buildAgentSummariesMock: vi.fn(),
  buildAvailableAgentWhereClauseMock: vi.fn(),
  getCreditCostsOrThrowMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/helpers/agent", () => ({
  buildAvailableAgentWhereClause: buildAvailableAgentWhereClauseMock,
  getCreditCostsOrThrow: getCreditCostsOrThrowMock,
}));

vi.mock("@/helpers/agent-summary", () => ({
  buildAgentSummaries: buildAgentSummariesMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

function createApp(
  withWorkspace = true,
  workspaceUserId: string | null = "user_123",
) {
  const app = new OpenAPIHono<{
    Variables: AuthVariables & WorkspaceVariables;
  }>({
    defaultHook: (result) => {
      if (!result.success && result.error) {
        throw unprocessableEntity(formatZodErrorMessage(result.error));
      }
    },
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "test-req-id");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: null,
      role: "user",
    });
    c.set(
      "workspaceContext",
      withWorkspace
        ? {
            workspaceId: "workspace_1",
            userId: workspaceUserId,
            organizationId: null,
          }
        : null,
    );
    return await next();
  });

  mountGetHiredAgents(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

function summary(id: string) {
  return {
    id,
    createdAt: new Date("2026-03-17T10:00:00.000Z"),
    updatedAt: new Date("2026-03-17T10:00:00.000Z"),
    name: id,
    image: null,
    icon: null,
    credits: 5,
    summary: null,
    description: "desc",
    metrics: {
      executions: { count: 1, averageTime: null },
      ratings: { total: 0, average: null },
    },
    author: {
      name: null,
      image: null,
      organization: null,
      email: null,
      other: null,
    },
    legal: { privacyPolicy: null, terms: null, dpa: null, other: null },
    categories: [],
  };
}

describe("GET /agents/hired", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    buildAvailableAgentWhereClauseMock.mockReturnValue({ isAvailable: true });
    getCreditCostsOrThrowMock.mockResolvedValue([]);
    prismaTransactionMock.mockImplementation(async (callback) => {
      return await callback({
        agent: {
          findMany: agentFindManyMock,
        },
      });
    });
  });

  it("returns hired agents ordered by most recent job activity", async () => {
    agentFindManyMock.mockResolvedValue([
      { id: "older", jobs: [{ createdAt: new Date("2026-01-01T00:00:00Z") }] },
      { id: "newer", jobs: [{ createdAt: new Date("2026-05-01T00:00:00Z") }] },
    ]);
    // Echo back ids in the (already-sorted) order they were passed in.
    buildAgentSummariesMock.mockImplementation(
      async (rows: Array<{ id: string }>) => rows.map((row) => summary(row.id)),
    );

    const app = createApp();
    const response = await app.request("http://localhost/hired");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              jobs: {
                some: { workspaceId: "workspace_1", userId: "user_123" },
              },
            },
          ],
        },
      }),
    );
    expect(body.data.map((agent: { id: string }) => agent.id)).toEqual([
      "newer",
      "older",
    ]);
  });

  it("scopes by the caller's id even in an org workspace (null workspace owner)", async () => {
    agentFindManyMock.mockResolvedValue([]);
    buildAgentSummariesMock.mockResolvedValue([]);

    // Organization workspace: workspaceContext.userId is null, but the query
    // must still filter by the authenticated caller's id, not match all members.
    const app = createApp(true, null);
    const response = await app.request("http://localhost/hired");

    expect(response.status).toBe(200);
    expect(agentFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { isAvailable: true },
            {
              jobs: {
                some: { workspaceId: "workspace_1", userId: "user_123" },
              },
            },
          ],
        },
      }),
    );
  });

  it("returns 403 when there is no active workspace", async () => {
    const app = createApp(false);
    const response = await app.request("http://localhost/hired");

    expect(response.status).toBe(403);
    expect(agentFindManyMock).not.toHaveBeenCalled();
  });
});
