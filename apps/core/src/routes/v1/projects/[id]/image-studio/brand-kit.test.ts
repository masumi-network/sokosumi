import { OpenAPIHono } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const mocks = vi.hoisted(() => ({
  referenceFiles: vi.fn(),
  project: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
  requireProjectAccess: vi.fn(),
  prepareStudioWebsiteDraft: vi.fn(),
  readStudioBrandKit: vi.fn(),
  saveStudioBrandCopy: vi.fn(),
}));

vi.mock("@/lib/image-studio/reference-files", () => ({
  requireStudioReferenceFiles: mocks.referenceFiles,
}));
vi.mock("@/lib/db/transaction", () => ({
  serializableTransaction: (
    run: (tx: { project: typeof mocks.project }) => unknown,
  ) => run({ project: mocks.project }),
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.requireProjectAccess,
}));
vi.mock("@/lib/image-studio/studio-brand", () => ({
  prepareStudioWebsiteDraft: mocks.prepareStudioWebsiteDraft,
  readStudioBrandKit: mocks.readStudioBrandKit,
}));
vi.mock("@/services/brand-brain.service", () => ({
  saveStudioBrandCopy: mocks.saveStudioBrandCopy,
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

  it("adds and removes one brand image while preserving the rest of the kit", async () => {
    const mascot = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "mascot.png",
    };
    const other = {
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      name: "packaging.jpg",
    };
    const change = (body: unknown) =>
      app().request(`/${projectId}/image-studio/brand-kit/assets`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    mocks.project.findUniqueOrThrow.mockResolvedValueOnce({
      studioBrandAssets: [other],
    });
    expect((await (await change({ add: mascot })).json()).data).toEqual([
      other,
      mascot,
    ]);
    expect(mocks.referenceFiles).toHaveBeenCalledWith(
      {
        workspaceId: scope.workspaceId,
        actor: {
          kind: "interactive",
          userId: scope.userId,
          organizationId: null,
        },
        resourceIds: [mascot.id],
      },
      expect.anything(),
    );
    expect(mocks.project.update).toHaveBeenCalledWith({
      where: { id: projectId },
      data: { studioBrandAssets: [other, mascot] },
    });
    mocks.project.findUniqueOrThrow.mockResolvedValueOnce({
      studioBrandAssets: [other, mascot],
    });
    expect((await (await change({ remove: mascot.id })).json()).data).toEqual([
      other,
    ]);
    mocks.referenceFiles.mockRejectedValueOnce(new HTTPException(404));
    mocks.project.findUniqueOrThrow.mockResolvedValueOnce({
      studioBrandAssets: null,
    });
    expect((await change({ add: mascot })).status).toBe(404);
    expect(mocks.project.update).toHaveBeenCalledTimes(2);
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

  // SOKD-480: the copy GET returns, tone "" included, can be sent back.
  it("takes back the copy GET returned, with an empty tone", async () => {
    mocks.readStudioBrandKit.mockResolvedValue({
      logo: null,
      colors: [],
      fonts: [],
      summary: "A ceramics studio",
      tone: "",
      audience: [],
      approvedLines: [],
      version: null,
    });
    mocks.saveStudioBrandCopy.mockResolvedValue("2026-11-26T12:00:00.000Z");
    const server = app();
    const kitPath = `/${projectId}/image-studio/brand-kit`;
    const kit = (await (await server.request(kitPath)).json()).data;

    const response = await server.request(kitPath, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        copy: {
          summary: kit.summary,
          tone: kit.tone,
          audience: kit.audience,
          approvedLines: [...kit.approvedLines, "E2E tagline"],
        },
        version: kit.version,
      }),
    });

    expect(response.status).toBe(200);
    expect(mocks.saveStudioBrandCopy).toHaveBeenCalledWith(
      projectId,
      expect.objectContaining({ tone: "", approvedLines: ["E2E tagline"] }),
      null,
    );
  });
});
