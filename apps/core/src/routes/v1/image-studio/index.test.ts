import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";

const mocks = vi.hoisted(() => ({
  resolveWorkspace: vi.fn(),
  requireWorkspaceAccess: vi.fn(),
  reconcileWorkspaceJobs: vi.fn(),
  listAssets: vi.fn(),
  listJobs: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/middleware/auth")>()),
  authMiddleware: (await import("@/test-fixtures/auth-middleware"))
    .stubAuthMiddleware,
}));
vi.mock("@/middleware/coworker-context", () => ({
  coworkerContextMiddleware: async (
    _c: unknown,
    next: () => Promise<unknown>,
  ) => await next(),
}));
vi.mock("@/middleware/organization", () => ({
  organizationContextMiddleware: async (
    _c: unknown,
    next: () => Promise<unknown>,
  ) => await next(),
}));
vi.mock("@sokosumi/database/repositories", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sokosumi/database/repositories")>()),
  workspaceRepository: { resolveWorkspaceForContext: mocks.resolveWorkspace },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireWorkspaceAccess: mocks.requireWorkspaceAccess,
}));
vi.mock("@/services/image-studio-jobs.service", () => ({
  reconcileWorkspaceJobs: mocks.reconcileWorkspaceJobs,
}));
vi.mock("@/services/image-studio-assets.service", () => ({
  listAssets: mocks.listAssets,
  listJobs: mocks.listJobs,
}));
vi.mock("@/lib/image-studio/fal-catalog-refresh", () => ({
  ensureImageCatalogFresh: vi.fn(),
}));

import imageStudioRouter from "./index";

function createApp(organizationId: string | null) {
  const app = new Hono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-state-request");
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: "user-a",
      organizationId,
      role: "user",
    });
    await next();
  });
  app.onError(errorHandler);
  app.route("/v1/image-studio", imageStudioRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listAssets.mockResolvedValue({ assets: [], nextCursor: null });
  mocks.listJobs.mockResolvedValue([]);
});

describe("workspace Studio router", () => {
  it.each([null, "org-a"])(
    "resolves workspace before reading state (organization: %s)",
    async (organizationId) => {
      mocks.resolveWorkspace.mockResolvedValue({
        id: "workspace-a",
        userId: organizationId ? null : "user-a",
        organizationId,
      });
      const response = await createApp(organizationId).request(
        "/v1/image-studio/state",
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        data: { assets: [], jobs: [], nextCursor: null },
      });
      expect(mocks.resolveWorkspace).toHaveBeenCalledWith(
        "user-a",
        organizationId,
        expect.anything(),
      );
      const scope = {
        projectId: null,
        workspaceId: "workspace-a",
        userId: "user-a",
      };
      expect(mocks.requireWorkspaceAccess).toHaveBeenCalledWith(scope);
      expect(mocks.reconcileWorkspaceJobs).toHaveBeenCalledWith("workspace-a");
      expect(mocks.listAssets).toHaveBeenCalledWith({ ...scope, limit: 100 });
      expect(mocks.listJobs).toHaveBeenCalledWith({ ...scope, limit: 50 });
    },
  );
});
