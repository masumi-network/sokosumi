import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const {
  createImageJobMock,
  createVideoJobMock,
  createShortVideoJobMock,
  createTalkingVideoJobMock,
  requestCancelMock,
} = vi.hoisted(() => ({
  createImageJobMock: vi.fn(),
  createVideoJobMock: vi.fn(),
  createShortVideoJobMock: vi.fn(),
  createTalkingVideoJobMock: vi.fn(),
  requestCancelMock: vi.fn(),
}));

vi.mock("@/services/image-studio-jobs.service", () => ({
  createImageJob: createImageJobMock,
  createVideoJob: createVideoJobMock,
  createShortVideoJob: createShortVideoJobMock,
  createTalkingVideoJob: createTalkingVideoJobMock,
  requestCancel: requestCancelMock,
  DEFAULT_SETTINGS: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
}));

import mountCancel from "./job-cancel-post";
import mount from "./jobs-post";
import mountShortVideo from "./short-video-jobs-post";
import mountTalkingVideo from "./talking-video-jobs-post";
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

const SESSION: AuthenticationContext = {
  actor: "user",
  authenticationMethod: "session",
  userId: "user-a",
  organizationId: null,
  role: "user",
};

function createApp(authContext: AuthenticationContext = SESSION) {
  const app = new OpenAPIHono<EnvVariables>();
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-create-request");
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: "workspace-a",
      userId: "user-a",
      organizationId: null,
    });
    await next();
  });
  app.onError(errorHandler);
  mount(app);
  mountVideo(app);
  mountShortVideo(app);
  mountTalkingVideo(app);
  mountCancel(app);
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

const SCRIPT =
  "Meet the vase that makes every shelf look finished. Order yours today.";

/** Every start and the cancel, as an agent would send them. */
const AGENT_CALLS = [
  {
    path: `/${PROJECT_ID}/image-studio/jobs`,
    body: { prompt: "A red vase", referenceFileIds: [PHOTO_ID] },
    service: createImageJobMock,
    fileActor: (input: Record<string, unknown>) => input.referenceFileActor,
  },
  {
    path: `/${PROJECT_ID}/image-studio/video-jobs`,
    body: { prompt: "A red vase turning" },
    service: createVideoJobMock,
    fileActor: null,
  },
  {
    path: `/${PROJECT_ID}/image-studio/short-video-jobs`,
    body: { format: "voiceover", script: SCRIPT, pictureFileIds: [PHOTO_ID] },
    service: createShortVideoJobMock,
    fileActor: (input: Record<string, unknown>) =>
      (input.pictures as { actor: unknown }).actor,
  },
  {
    path: `/${PROJECT_ID}/image-studio/talking-video-jobs`,
    body: { script: SCRIPT, presenter: { kind: "stock", id: "ada" } },
    service: createTalkingVideoJobMock,
    fileActor: null,
  },
  {
    path: `/${PROJECT_ID}/image-studio/jobs/${JOB_ID}/cancel`,
    body: null,
    service: requestCancelMock,
    fileActor: null,
  },
] as const;

function send(
  app: ReturnType<typeof createApp>,
  call: (typeof AGENT_CALLS)[number],
) {
  return app.request(call.path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body:
      call.body === null
        ? undefined
        : JSON.stringify({ ...call.body, idempotencyKey: "agent-intent-a" }),
  });
}

describe("agents start and cancel Studio generations (ADR 0077)", () => {
  beforeEach(() => {
    for (const mock of [
      createImageJobMock,
      createVideoJobMock,
      createShortVideoJobMock,
      createTalkingVideoJobMock,
    ]) {
      mock.mockResolvedValue(QUEUED_JOB);
    }
    requestCancelMock.mockResolvedValue({ accepted: true });
  });

  it.each(
    (["api_key", "oauth"] as const).flatMap((authenticationMethod) =>
      AGENT_CALLS.map((call) => ({ authenticationMethod, call })),
    ),
  )(
    "lets $authenticationMethod call $call.path as its own user",
    async ({ authenticationMethod, call }) => {
      const response = await send(
        createApp({ ...SESSION, authenticationMethod }),
        call,
      );

      expect(response.status).toBeLessThan(300);
      expect(call.service).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ userId: "user-a", projectId: PROJECT_ID }),
      );
      // Files are read as the caller's credential, never as a browser session.
      if (call.fileActor) {
        expect(call.fileActor(call.service.mock.calls[0][0])).toEqual({
          userId: "user-a",
          organizationId: null,
          kind: authenticationMethod,
        });
      }
    },
  );

  it.each(AGENT_CALLS)("refuses a Coworker key on $path", async (call) => {
    const response = await send(
      createApp({
        actor: "coworker",
        coworkerId: "cw-1",
        vendorId: "vendor-1",
        context: { userId: "user-a", organizationId: null },
      }),
      call,
    );

    expect(response.status).toBe(403);
    expect(call.service).not.toHaveBeenCalled();
  });

  it.each(AGENT_CALLS.filter((call) => call.body !== null))(
    "refuses a start on $path without an idempotencyKey",
    async (call) => {
      const response = await createApp({
        ...SESSION,
        authenticationMethod: "api_key",
      }).request(call.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(call.body),
      });

      expect(response.status).toBe(422);
      expect(call.service).not.toHaveBeenCalled();
    },
  );
});

describe("a talking video of a real person's photo (ADR 0077)", () => {
  const request = (authContext: AuthenticationContext) =>
    createApp(authContext).request(
      `/${PROJECT_ID}/image-studio/talking-video-jobs`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          script: SCRIPT,
          presenter: { kind: "file", fileId: PHOTO_ID, consent: true },
          idempotencyKey: "agent-intent-a",
        }),
      },
    );

  beforeEach(() => {
    createTalkingVideoJobMock.mockResolvedValue(QUEUED_JOB);
  });

  it.each(["api_key", "oauth"] as const)(
    "is a person's step for %s: an agent cannot consent for someone's face",
    async (authenticationMethod) => {
      const response = await request({ ...SESSION, authenticationMethod });

      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        kind: string;
        webUrl: string;
      };
      expect(body.kind).toBe("person_approval_required");
      expect(new URL(body.webUrl).pathname).toBe("/studio");
      expect(new URL(body.webUrl).searchParams.get("projectId")).toBe(
        PROJECT_ID,
      );
      expect(createTalkingVideoJobMock).not.toHaveBeenCalled();
    },
  );

  it("still starts for a person in the browser, with their consent", async () => {
    const response = await request(SESSION);

    expect(response.status).toBe(201);
    expect(createTalkingVideoJobMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        presenter: expect.objectContaining({
          kind: "file",
          fileId: PHOTO_ID,
          actor: {
            userId: "user-a",
            organizationId: null,
            kind: "interactive",
          },
        }),
      }),
    );
  });
});
