import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnvVariables } from "@/lib/hono";

const { createImageJobMock } = vi.hoisted(() => ({
  createImageJobMock: vi.fn(),
}));

vi.mock("@/services/image-studio-jobs.service", () => ({
  createImageJob: createImageJobMock,
  DEFAULT_SETTINGS: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
}));

import mount from "./jobs-post";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHOTO_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /projects/{id}/image-studio/jobs", () => {
  it.each(["QUEUED", "SUCCEEDED"])(
    "returns a valid job response including its project (%s)",
    async (status) => {
      // The service can return either a new job or an existing idempotent replay.
      createImageJobMock.mockResolvedValue({
        id: JOB_ID,
        projectId: PROJECT_ID,
        status,
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
      });

      const response = await createApp().request(
        `/${PROJECT_ID}/image-studio/jobs`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: "A red vase",
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
          userId: "user-a",
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
});
