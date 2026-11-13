import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const mocks = vi.hoisted(() => ({
  next: vi.fn(),
  save: vi.fn(),
  scoreboard: vi.fn(),
}));

vi.mock("@/services/studio-compare.service", () => ({
  getStudioComparePair: mocks.next,
  saveStudioPairwisePick: mocks.save,
  getStudioModelScoreboard: mocks.scoreboard,
}));

import mountGet from "./compare-get";
import mountPut from "./compare-put";
import mountScoreboard from "./model-scoreboard-get";

const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BATCH = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PICK = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const SESSION: AuthenticationContext = {
  actor: "user",
  authenticationMethod: "session",
  userId: "user-a",
  organizationId: null,
  role: "user",
};
const COMPARE_PATH = `/${PROJECT}/image-studio/batches/${BATCH}/compare`;
const SCOREBOARD_PATH = `/${PROJECT}/image-studio/model-scoreboard`;

function createApp(authContext: AuthenticationContext = SESSION) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("requestId", "compare-test");
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: "workspace-a",
      userId: "user-a",
      organizationId: null,
    });
    await next();
  });
  mountGet(app);
  mountPut(app);
  mountScoreboard(app);
  return app;
}

function saveRequest(
  body: unknown = { assetId: A, otherAssetId: B, outcome: "A" },
) {
  return {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.next.mockResolvedValue(null);
  mocks.save.mockResolvedValue({
    id: PICK,
    assetId: A,
    otherAssetId: B,
    outcome: "A",
  });
  mocks.scoreboard.mockResolvedValue({ models: [], minimumComparisons: 10 });
});

describe("studio comparison routes", () => {
  it("returns done and scopes the next pair to the interactive user's workspace", async () => {
    const response = await createApp().request(COMPARE_PATH);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { pair: null } });
    expect(mocks.next).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT,
      batchId: BATCH,
      workspaceId: "workspace-a",
      userId: "user-a",
    });
  });

  it("returns private Core content paths for both images", async () => {
    function asset(id: string) {
      return {
        id,
        projectId: PROJECT,
        projectName: "Launch",
        rootId: id,
        parentId: null,
        version: 1,
        prompt: "A red vase",
        model: "model-a",
        width: 1024,
        height: 1024,
        bytes: 100,
        contentType: "image/png",
        mediaType: "IMAGE",
        video: null,
        createdAt: new Date("2026-11-13T08:00:00Z"),
        jobId: id,
        settings: { aspectRatio: "1:1" },
        batchBrief: "Server-only brief",
      };
    }
    mocks.next.mockResolvedValue({ a: asset(A), b: asset(B) });
    const response = await createApp().request(COMPARE_PATH);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data.pair.a.contentPath).toBe(
      `/v1/projects/${PROJECT}/image-studio/assets/${A}/content`,
    );
    expect(body.data.pair.b.contentPath).toBe(
      `/v1/projects/${PROJECT}/image-studio/assets/${B}/content`,
    );
    expect(body.data.pair.a).not.toHaveProperty("batchBrief");
  });

  it("saves a pick through the batch scope", async () => {
    const response = await createApp().request(COMPARE_PATH, saveRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { id: PICK, outcome: "A" },
    });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT,
      batchId: BATCH,
      workspaceId: "workspace-a",
      userId: "user-a",
      assetId: A,
      otherAssetId: B,
      outcome: "A",
    });
  });

  it.each([
    { assetId: "invalid", otherAssetId: B, outcome: "A" },
    { assetId: A, otherAssetId: B, outcome: "WIN" },
    { assetId: A, outcome: "TIE" },
  ])("rejects invalid input before writing (%j)", async (body) => {
    const response = await createApp().request(COMPARE_PATH, saveRequest(body));
    expect(response.status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("returns project-scoped model scores", async () => {
    mocks.scoreboard.mockResolvedValue({
      models: [
        {
          model: "flux-2-pro",
          comparisons: 2,
          winRate: 0.75,
          elo: 1016,
          provisional: true,
        },
      ],
      minimumComparisons: 10,
    });
    const response = await createApp().request(SCOREBOARD_PATH);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { models: [{ model: "flux-2-pro", comparisons: 2 }] },
    });
    expect(mocks.scoreboard).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT,
      workspaceId: "workspace-a",
      userId: "user-a",
    });
  });

  it("does not reveal a project when access was revoked", async () => {
    mocks.next.mockRejectedValue(notFound("Project not found"));
    const response = await createApp().request(COMPARE_PATH);
    expect(response.status).toBe(404);
  });

  it.each([
    { ...SESSION, authenticationMethod: "api_key" },
    { actor: "coworker", coworkerId: "coworker-a", vendorId: "vendor-a" },
  ] satisfies AuthenticationContext[])(
    "refuses non-interactive actors on all three routes (%j)",
    async (authContext) => {
      const app = createApp(authContext);
      const responses = await Promise.all([
        app.request(COMPARE_PATH),
        app.request(COMPARE_PATH, saveRequest()),
        app.request(SCOREBOARD_PATH),
      ]);
      expect(responses.map((response) => response.status)).toEqual([
        403, 403, 403,
      ]);
      expect(mocks.next).not.toHaveBeenCalled();
      expect(mocks.save).not.toHaveBeenCalled();
      expect(mocks.scoreboard).not.toHaveBeenCalled();
    },
  );
});
