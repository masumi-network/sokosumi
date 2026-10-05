import { APIError } from "better-auth/api";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { conflict } from "@/helpers/error";
import { errorHandler } from "@/helpers/error-handler.js";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import {
  type UserRouteVariables,
  usersPathUserContextMiddleware,
} from "@/routes/v1/users/user-route-context";

import mountPostUserWorkspaces from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  captureExceptionMock,
  createOrganizationMock,
  createPersonalWorkspaceMock,
  getUserWorkspaceMock,
  setPreferredOrganizationIdMock,
  userFindUniqueMock,
} = vi.hoisted(() => ({
  captureExceptionMock: vi.fn(),
  createOrganizationMock: vi.fn(),
  createPersonalWorkspaceMock: vi.fn(),
  getUserWorkspaceMock: vi.fn(),
  setPreferredOrganizationIdMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
}));

vi.mock("@sentry/node", () => ({
  captureException: captureExceptionMock,
}));

vi.mock("@/lib/auth", () => ({
  auth: { api: { createOrganization: createOrganizationMock } },
}));

vi.mock("@/helpers/personal-workspace", () => ({
  createPersonalWorkspace: createPersonalWorkspaceMock,
}));

vi.mock("@/helpers/user-workspaces", () => ({
  getUserWorkspace: getUserWorkspaceMock,
}));

vi.mock("@/services/preferred-organization.service", () => ({
  setPreferredOrganizationId: setPreferredOrganizationIdMock,
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { user: { findUnique: userFindUniqueMock } },
}));

const SESSION_USER: AuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: null,
  role: "user",
};

const WORKSPACE_ID = "11111111-1111-7111-8111-111111111111";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    c.set("isAuthenticated", true);
    c.set("authContext", SESSION_USER);
    return await next();
  });
  const userByIdApp = new OpenAPIHonoWithAuth<UserRouteVariables>();
  userByIdApp.use("*", usersPathUserContextMiddleware);
  mountPostUserWorkspaces(userByIdApp);
  app.route("/:id", userByIdApp);
  return app;
}

function post(body: unknown) {
  return createApp().request("/me/workspaces", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /users/{id}/workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    userFindUniqueMock.mockResolvedValue({ id: "user_123" });
  });

  it("creates a personal workspace and returns it", async () => {
    createPersonalWorkspaceMock.mockResolvedValue({ id: WORKSPACE_ID });
    const workspace = {
      id: WORKSPACE_ID,
      kind: "personal",
      name: "Ada Lovelace",
      organizationId: null,
      slug: null,
      preferred: true,
    };
    getUserWorkspaceMock.mockResolvedValue(workspace);

    const response = await post({ kind: "personal" });

    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual(workspace);
    expect(createPersonalWorkspaceMock).toHaveBeenCalledWith("user_123");
    expect(getUserWorkspaceMock).toHaveBeenCalledWith("user_123", {
      id: WORKSPACE_ID,
    });
  });

  it("returns 409 when the personal workspace already exists", async () => {
    createPersonalWorkspaceMock.mockRejectedValue(
      conflict("Personal workspace already exists"),
    );

    const response = await post({ kind: "personal" });

    expect(response.status).toBe(409);
  });

  it("creates an organization with a slug and website, then prefers it", async () => {
    createOrganizationMock.mockResolvedValue({ id: "org_1" });
    const workspace = {
      id: WORKSPACE_ID,
      kind: "organization",
      name: "Acme Studio",
      organizationId: "org_1",
      slug: "acme-studio-abc123",
      preferred: true,
    };
    getUserWorkspaceMock.mockResolvedValue(workspace);

    const response = await post({
      kind: "organization",
      name: "  Acme Studio ",
      websiteUrl: "acme.com",
    });

    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual(workspace);
    expect(createOrganizationMock).toHaveBeenCalledWith({
      body: {
        name: "Acme Studio",
        slug: expect.stringMatching(/^acme-studio-[a-z0-9]{6}$/),
        metadata: { url: "https://acme.com/" },
        userId: "user_123",
      },
    });
    expect(setPreferredOrganizationIdMock).toHaveBeenCalledWith(
      "user_123",
      "org_1",
    );
    expect(getUserWorkspaceMock).toHaveBeenCalledWith("user_123", {
      organizationId: "org_1",
    });
  });

  it("still returns the created organization when making it preferred fails", async () => {
    createOrganizationMock.mockResolvedValue({ id: "org_1" });
    const failure = new Error("connection reset");
    setPreferredOrganizationIdMock.mockRejectedValue(failure);
    const workspace = {
      id: WORKSPACE_ID,
      kind: "organization",
      name: "Acme",
      organizationId: "org_1",
      slug: "acme-abc123",
      preferred: false,
    };
    getUserWorkspaceMock.mockResolvedValue(workspace);

    const response = await post({
      kind: "organization",
      name: "Acme",
      websiteUrl: "acme.com",
    });

    expect(response.status).toBe(201);
    expect((await response.json()).data).toEqual(workspace);
    expect(captureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        extra: expect.objectContaining({ organizationId: "org_1" }),
      }),
    );
  });

  it.each([
    ["a missing website", { kind: "organization", name: "Acme" }],
    [
      "an invalid website",
      { kind: "organization", name: "Acme", websiteUrl: "not a url" },
    ],
    [
      "a too short name",
      { kind: "organization", name: "A", websiteUrl: "acme.com" },
    ],
    ["an unknown kind", { kind: "team" }],
  ])("rejects %s", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(422);
    expect(createOrganizationMock).not.toHaveBeenCalled();
    expect(createPersonalWorkspaceMock).not.toHaveBeenCalled();
  });

  it("returns 403 when Better Auth refuses at the organization limit", async () => {
    createOrganizationMock.mockRejectedValue(
      new APIError("FORBIDDEN", {
        message: "You have reached the maximum number of organizations",
      }),
    );

    const response = await post({
      kind: "organization",
      name: "Acme",
      websiteUrl: "acme.com",
    });

    expect(response.status).toBe(403);
    expect(setPreferredOrganizationIdMock).not.toHaveBeenCalled();
  });
});
