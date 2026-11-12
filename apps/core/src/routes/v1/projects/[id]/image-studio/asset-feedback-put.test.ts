import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { notFound } from "@/helpers/error";
import { defaultValidationHook, type EnvVariables } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";

const mocks = vi.hoisted(() => ({
  feedback: vi.fn(),
  view: vi.fn(),
  hide: vi.fn(),
}));
vi.mock("@/services/image-studio-feedback.service", () => ({
  setStudioAssetFeedback: mocks.feedback,
  recordStudioAssetLightboxView: mocks.view,
  hideStudioAsset: mocks.hide,
}));

import mountEvents from "./asset-events-post";
import mountFeedback from "./asset-feedback-put";
import mountHide from "./asset-hide-post";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ASSET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const BASE = `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}`;
const USER = {
  actor: "user",
  authenticationMethod: "session",
  userId: "user-a",
  organizationId: null,
  role: "user",
} satisfies AuthenticationContext;

function createApp(authContext: AuthenticationContext = USER) {
  const app = new OpenAPIHono<EnvVariables>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-feedback-request");
    c.set("authContext", authContext);
    c.set("workspaceContext", {
      workspaceId: "workspace-a",
      userId: "user-a",
      organizationId: null,
    });
    await next();
  });
  mountFeedback(app);
  mountEvents(app);
  mountHide(app);
  return app;
}

function feedbackRequest(body: object) {
  return {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.feedback.mockResolvedValue({
    myThumb: 1,
    myReasons: ["great"],
    myComment: null,
    thumbsUp: 1,
    thumbsDown: 0,
    score: 2 / 3,
  });
});

describe("studio feedback routes", () => {
  it("sets feedback with the authenticated user and active workspace", async () => {
    const response = await createApp().request(
      `${BASE}/feedback`,
      feedbackRequest({ thumb: 1, reasons: ["great"] }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { myThumb: 1, myReasons: ["great"], thumbsUp: 1 },
    });
    expect(mocks.feedback).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      userId: "user-a",
      workspaceId: "workspace-a",
      thumb: 1,
      reasons: ["great"],
    });
  });

  it("accepts an explicit null thumb for clearing", async () => {
    const response = await createApp().request(
      `${BASE}/feedback`,
      feedbackRequest({ thumb: null }),
    );
    expect(response.status).toBe(200);
    expect(mocks.feedback).toHaveBeenCalledWith(
      expect.objectContaining({ thumb: null }),
    );
  });

  it.each([
    { thumb: 0 },
    { thumb: 1, reasons: ["unrecognized"] },
    { thumb: 1, comment: "x".repeat(501) },
  ])("rejects invalid feedback %j", async (body) => {
    const response = await createApp().request(
      `${BASE}/feedback`,
      feedbackRequest(body),
    );
    expect(response.status).toBe(422);
    expect(mocks.feedback).not.toHaveBeenCalled();
  });

  it("requires an interactive session", async () => {
    const response = await createApp({
      ...USER,
      authenticationMethod: "api_key",
    }).request(`${BASE}/feedback`, feedbackRequest({ thumb: 1 }));
    expect(response.status).toBe(403);
    expect(mocks.feedback).not.toHaveBeenCalled();
  });

  it("returns 404 for an asset outside the user's workspace", async () => {
    mocks.feedback.mockRejectedValue(notFound("Image not found"));
    const response = await createApp().request(
      `${BASE}/feedback`,
      feedbackRequest({ thumb: 1 }),
    );
    expect(response.status).toBe(404);
  });

  it("accepts only viewed_lightbox from the browser", async () => {
    const app = createApp();
    const request = (type: string) => ({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    expect(
      (await app.request(`${BASE}/events`, request("viewed_lightbox"))).status,
    ).toBe(204);
    expect(mocks.view).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      userId: "user-a",
      workspaceId: "workspace-a",
    });
    expect(
      (await app.request(`${BASE}/events`, request("downloaded"))).status,
    ).toBe(422);
    expect(mocks.view).toHaveBeenCalledTimes(1);
  });

  it("hides the scoped asset", async () => {
    const response = await createApp().request(`${BASE}/hide`, {
      method: "POST",
    });
    expect(response.status).toBe(204);
    expect(mocks.hide).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
      userId: "user-a",
      workspaceId: "workspace-a",
    });
  });
});
