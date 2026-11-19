import { OpenAPIHono } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { err, ok } from "neverthrow";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import { coreEvlogMiddleware } from "@/lib/evlog";
import type { EnvVariables } from "@/lib/hono";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  write: vi.fn(),
}));

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: mocks.access,
}));
vi.mock("@/services/image-studio-caption.service", () => ({
  writeStudioAssetCaption: mocks.write,
}));
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/node")>()),
  captureException: vi.fn(),
}));
vi.mock("@/lib/redis-rate-limit", () => ({
  incrementRedisRateLimit: vi.fn(),
}));

import mount from "./asset-caption-post";

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const ASSET_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function createApp() {
  const app = new OpenAPIHono<EnvVariables>();
  app.use(coreEvlogMiddleware());
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("requestId", "studio-caption-request");
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
  mocks.access.mockResolvedValue({
    projectId: PROJECT_ID,
    workspaceId: "workspace-a",
    userId: "user-a",
    organizationId: null,
  });
  mocks.write.mockResolvedValue(ok("Late sun on a red fox."));
});

describe("POST /projects/{id}/image-studio/assets/{assetId}/caption", () => {
  it("returns a caption for the image", async () => {
    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { text: "Late sun on a red fox." },
    });
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith({
      projectId: PROJECT_ID,
      assetId: ASSET_ID,
    });
  });

  it("returns 404 when the image is gone", async () => {
    mocks.write.mockResolvedValue(err("missing"));

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(404);
  });

  it("returns 503 when writing fails", async () => {
    expectCoreLog("error", "A request failed with a server error");
    mocks.write.mockRejectedValue(new Error("gateway down"));

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(503);
  });

  it("returns 503 when the model writes nothing", async () => {
    expectCoreLog("error", "A request failed with a server error");
    mocks.write.mockResolvedValue(err("empty"));

    const response = await createApp().request(
      `/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`,
      { method: "POST" },
    );

    expect(response.status).toBe(503);
  });

  it("returns a 503 budget refusal with a single shared alert and no Sentry capture", async () => {
    vi.mocked(incrementRedisRateLimit)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2);
    mocks.write.mockImplementation(() =>
      rethrowAiGatewayFailure(
        Object.assign(new Error("API key budget exceeded"), {
          name: "GatewayInternalServerError",
        }),
      ),
    );
    expectCoreLog("error", "AI Gateway budget exhausted");
    expectCoreLog("warn", "AI Gateway budget exhausted");
    const app = createApp();
    const request = () =>
      app.request(`/${PROJECT_ID}/image-studio/assets/${ASSET_ID}/caption`, {
        method: "POST",
      });

    for (const response of [await request(), await request()]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        kind: "ai_budget_exceeded",
        message:
          "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets.",
      });
    }
    expect(coreLogEvents()).toMatchObject([
      {
        status: 503,
        level: "error",
        error: { message: "AI Gateway budget exhausted" },
      },
      { status: 503, level: "warn" },
    ]);
    expect(coreLogEvents()[1]).not.toHaveProperty("error");
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
