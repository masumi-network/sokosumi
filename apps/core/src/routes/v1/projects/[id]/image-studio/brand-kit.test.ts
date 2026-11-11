import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const mocks = vi.hoisted(() => ({
  requireProjectAccess: vi.fn(),
  prepareStudioWebsiteDraft: vi.fn(),
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.requireProjectAccess,
}));
vi.mock("@/lib/image-studio/studio-brand", () => ({
  prepareStudioWebsiteDraft: mocks.prepareStudioWebsiteDraft,
}));

import mount from "./brand-kit";

const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const path = `/${projectId}/image-studio/website-draft`;
const scope = { userId: "user-a", workspaceId: "workspace-a", projectId };

function app() {
  const server = new OpenAPIHono<EnvVariables>();
  server.use("*", async (c, next) => {
    c.set("requestId", "studio-brand");
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: scope.userId,
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      organizationId: null,
    });
    await next();
  });
  mount(server);
  return server;
}

describe("Studio website research", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.prepareStudioWebsiteDraft.mockResolvedValue({
      brandCopy: null,
      products: [],
    });
  });

  it("uses the caller's authorized workspace for POST research and keeps GET read-only", async () => {
    const server = app();
    expect((await server.request(path)).status).toBe(200);
    expect((await server.request(path, { method: "POST" })).status).toBe(200);
    expect(mocks.prepareStudioWebsiteDraft.mock.calls).toEqual([
      [projectId],
      [projectId, scope.workspaceId],
    ]);
    expect(mocks.requireProjectAccess.mock.calls).toEqual([[scope], [scope]]);
  });

  it("does not prepare the draft for an inaccessible project", async () => {
    mocks.requireProjectAccess.mockRejectedValueOnce(new HTTPException(404));
    expect((await app().request(path, { method: "POST" })).status).toBe(404);
    expect(mocks.prepareStudioWebsiteDraft).not.toHaveBeenCalled();
  });
});
