import { HTTPException } from "hono/http-exception";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import type { WorkspaceVariables } from "@/middleware/workspace";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  getMemberByUserIdAndOrganizationIdMock,
  projectFindFirstMock,
  resolveSiteIconAsOrganizationLogoMock,
  resolveSiteIconAsProjectLogoMock,
} = vi.hoisted(() => ({
  getMemberByUserIdAndOrganizationIdMock: vi.fn(),
  projectFindFirstMock: vi.fn(),
  resolveSiteIconAsOrganizationLogoMock: vi.fn(),
  resolveSiteIconAsProjectLogoMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: projectFindFirstMock },
  },
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

vi.mock("@/lib/site-icon", () => ({
  resolveSiteIconAsOrganizationLogo: (...args: unknown[]) =>
    resolveSiteIconAsOrganizationLogoMock(...args),
  resolveSiteIconAsProjectLogo: (...args: unknown[]) =>
    resolveSiteIconAsProjectLogoMock(...args),
}));

const USER_AUTH_CONTEXT: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_CONTEXT = {
  workspaceId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  userId: "user_123",
  organizationId: null,
} satisfies WorkspaceVariables["workspaceContext"];

let mountSiteIcon: (app: OpenAPIHonoWithAuth) => void;

function createApp(
  authContext: AuthenticationContext | null = USER_AUTH_CONTEXT,
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    if (!authContext) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    c.set("workspaceContext", WORKSPACE_CONTEXT);
    return await next();
  });

  mountSiteIcon(app);
  return app;
}

beforeAll(async () => {
  const module = await import("./get");
  mountSiteIcon = module.default;
});

beforeEach(() => {
  vi.clearAllMocks();
  resolveSiteIconAsOrganizationLogoMock.mockResolvedValue(
    "https://blob.example/organizations/org_123/logos/hash",
  );
  resolveSiteIconAsProjectLogoMock.mockResolvedValue(
    "https://blob.example/projects/11111111-1111-4111-8111-111111111111/logos/hash",
  );
  getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ id: "member_1" });
  projectFindFirstMock.mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
  });
});

describe("GET /tools/site-icon", () => {
  it("passes organizationId to the organization resolver", async () => {
    const response = await createApp().request(
      "http://localhost/site-icon?url=https://example.com&organizationId=org_123",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveSiteIconAsOrganizationLogoMock).toHaveBeenCalledWith(
      "https://example.com",
      "org_123",
    );
    expect(body.data.url).toBe(
      "https://blob.example/organizations/org_123/logos/hash",
    );
  });

  it("passes projectId to the project resolver", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const response = await createApp().request(
      `http://localhost/site-icon?url=https://example.com&projectId=${projectId}`,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveSiteIconAsProjectLogoMock).toHaveBeenCalledWith(
      "https://example.com",
      projectId,
    );
    expect(projectFindFirstMock).toHaveBeenCalledWith({
      where: { id: projectId, workspaceId: WORKSPACE_CONTEXT.workspaceId },
      select: { id: true },
    });
    expect(resolveSiteIconAsOrganizationLogoMock).not.toHaveBeenCalled();
    expect(body.data.url).toContain(`/projects/${projectId}/logos/`);
  });

  it("returns 404 for a project outside the active workspace", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    projectFindFirstMock.mockResolvedValueOnce(null);

    const response = await createApp().request(
      `http://localhost/site-icon?url=https://example.com&projectId=${projectId}`,
    );

    expect(response.status).toBe(404);
    expect(resolveSiteIconAsProjectLogoMock).not.toHaveBeenCalled();
  });

  it("returns 404 when caller is not an organization member", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValueOnce(null);

    const response = await createApp().request(
      "http://localhost/site-icon?url=https://example.com&organizationId=org_other",
    );

    expect(response.status).toBe(404);
    expect(resolveSiteIconAsOrganizationLogoMock).not.toHaveBeenCalled();
  });

  it("rejects requests missing organizationId", async () => {
    const response = await createApp().request(
      "http://localhost/site-icon?url=https://example.com",
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(resolveSiteIconAsOrganizationLogoMock).not.toHaveBeenCalled();
    expect(resolveSiteIconAsProjectLogoMock).not.toHaveBeenCalled();
  });

  it("rejects requests with both owner identifiers", async () => {
    const response = await createApp().request(
      "http://localhost/site-icon?url=https://example.com&organizationId=org_123&projectId=11111111-1111-4111-8111-111111111111",
    );

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
    expect(resolveSiteIconAsOrganizationLogoMock).not.toHaveBeenCalled();
    expect(resolveSiteIconAsProjectLogoMock).not.toHaveBeenCalled();
  });
});
