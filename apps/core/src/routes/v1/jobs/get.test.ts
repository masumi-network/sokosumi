import { OpenAPIHono } from "@hono/zod-openapi";
import { AgentJobStatus } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetJobs from "./get";

const { getMemberByUserIdAndOrganizationIdMock, getUserJobsMock } = vi.hoisted(
  () => ({
    getMemberByUserIdAndOrganizationIdMock: vi.fn(),
    getUserJobsMock: vi.fn(),
  }),
);

vi.mock("@/helpers/job", () => ({
  getUserJobs: (...args: unknown[]) => getUserJobsMock(...args),
}));

vi.mock("@sokosumi/database/repositories", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/repositories")>();

  return {
    ...actual,
    memberRepository: {
      ...actual.memberRepository,
      getMemberByUserIdAndOrganizationId:
        getMemberByUserIdAndOrganizationIdMock,
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {},
}));

function createApp() {
  const app = new OpenAPIHono<{
    Variables: AuthVariables;
  }>();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: "user_123",
      organizationId: "org_123",
    });

    return await next();
  });

  mountGetJobs(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

describe("GET /jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      id: "member_123",
    });
    getUserJobsMock.mockResolvedValue({
      jobs: [],
      count: 0,
      hasMore: false,
    });
  });

  it("passes memberId and includeFailed through to org-scoped job reads", async () => {
    const app = createApp();

    const response = await app.request(
      "http://localhost/?memberId=user_456&agentId=agent_456&status=COMPLETED&includeFailed=false",
    );

    expect(response.status).toBe(200);
    expect(getMemberByUserIdAndOrganizationIdMock).toHaveBeenCalledWith(
      "user_456",
      "org_123",
      expect.any(Object),
    );
    expect(getUserJobsMock).toHaveBeenCalledWith(
      {
        actor: "user",
        userId: "user_123",
        organizationId: "org_123",
      },
      expect.objectContaining({
        memberId: "user_456",
        agentId: "agent_456",
        status: AgentJobStatus.COMPLETED,
        includeFailed: false,
      }),
    );
  });

  it("rejects memberId values outside the active organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue(null);
    const app = createApp();

    const response = await app.request("http://localhost/?memberId=user_999");

    expect(response.status).toBe(400);
    expect(getUserJobsMock).not.toHaveBeenCalled();
  });
});
