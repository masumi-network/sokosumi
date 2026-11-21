import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const { createImageJobMock, createVideoJobMock } = vi.hoisted(() => ({
  createImageJobMock: vi.fn(),
  createVideoJobMock: vi.fn(),
}));

vi.mock("@/services/image-studio-jobs.service", () => ({
  createImageJob: createImageJobMock,
  createVideoJob: createVideoJobMock,
  DEFAULT_SETTINGS: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
}));

import mount from "./jobs-post";
import mountVideo from "./video-jobs-post";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHOTO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const QUEUED_JOB = {
  id: JOB_ID,
  projectId: PROJECT_ID,
  status: "QUEUED",
  kind: "GENERATE",
  model: "test-model",
  prompt: "A red vase",
  settings: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
  referenceAssetIds: [],
  referenceFileIds: [PHOTO_ID],
  error: null,
  failureReason: null,
  parentAssetId: null,
  createdAt: new Date("2026-10-06T08:00:00.000Z"),
  submittedAt: null,
  settledAt: null,
  cancelRequestedAt: null,
};

function createApp() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-create-request");
    c.set("authContext", {
      actor: "user",
      authenticationMethod: "session",
      userId: "user-a",
      organizationId: null,
      role: "user",
    });
    c.set("workspaceContext", {
      workspaceId: "workspace-a",
      userId: "user-a",
      organizationId: null,
    });
    await next();
  });
  mount(app);
  mountVideo(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("direct Studio generation", () => {
  it.each([
    { sourceAssetId: null, modelId: "h3-max" },
    { sourceAssetId: PHOTO_ID, modelId: "h3-max-animate" },
  ])(
    "routes a direct video with source $sourceAssetId to $modelId",
    async ({ sourceAssetId, modelId }) => {
      const app = createApp();
      createVideoJobMock.mockResolvedValueOnce({
        ...QUEUED_JOB,
        model: modelId,
      });
      const response = await app.request(
        `/${PROJECT_ID}/image-studio/video-jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "A red vase",
            sourceAssetId,
            modelId: "kling-v4",
            idempotencyKey: "video-intent-a",
          }),
        },
      );
      expect(response.status).toBe(201);
      expect(createVideoJobMock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ sourceAssetId, modelId }),
      );
    },
  );

  it("letters an existing backdrop without purchasing another scene", async () => {
    createImageJobMock.mockResolvedValue(QUEUED_JOB);
    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Keep the scene",
          referenceAssetIds: [PHOTO_ID],
          parentAssetId: PHOTO_ID,
          exportHeadline: "Made to last",
          lettering: "ideogram",
          letterExistingBackdrop: true,
          idempotencyKey: "letter-backdrop-a",
        }),
      },
    );
    expect(response.status).toBe(201);
    expect(createImageJobMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        modelId: "ideogram-v3",
        referenceAssetIds: [PHOTO_ID],
        exportHeadline: "Made to last",
      }),
    );
  });

  it.each(["QUEUED", "SUCCEEDED"])(
    "returns a valid job response including its project (%s)",
    async (status) => {
      // The service can return either a new job or an existing idempotent replay.
      createImageJobMock.mockResolvedValue({ ...QUEUED_JOB, status });

      const response = await createApp().request(
        `/${PROJECT_ID}/image-studio/jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "A red vase",
            modelId: "flux-2-pro",
            templateId: "social-post",
            creativeDirection: "lifestyle",
            variationIndex: 0,
            referenceFileIds: [PHOTO_ID],
            idempotencyKey: "generation-intent-a",
          }),
        },
      );

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        data: {
          id: JOB_ID,
          projectId: PROJECT_ID,
          status,
          referenceFileIds: [PHOTO_ID],
        },
      });
      expect(createImageJobMock).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          workspaceId: "workspace-a",
          modelId: "gemini-pro",
          userId: "user-a",
          templateId: "social-post",
          creativeDirection: "lifestyle",
          variationIndex: 0,
          referenceFileIds: [PHOTO_ID],
          referenceFileActor: {
            userId: "user-a",
            organizationId: null,
            kind: "interactive",
          },
          idempotencyKey: "generation-intent-a",
        }),
      );
    },
  );

  it.each([-1, 0.5, 2147483648])(
    "rejects invalid variation index %s",
    async (variationIndex) => {
      const response = await createApp().request(
        `/${PROJECT_ID}/image-studio/jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "A red vase",
            variationIndex,
            idempotencyKey: "generation-intent-a",
          }),
        },
      );

      expect(response.status).toBe(422);
      expect(createImageJobMock).not.toHaveBeenCalled();
    },
  );
});
