import { OpenAPIHono } from "@hono/zod-openapi";
import * as Sentry from "@sentry/node";
import { expect, it, vi } from "vitest";
import { errorHandler } from "@/helpers/error-handler";
import { rethrowAiGatewayFailure } from "@/lib/ai-gateway-budget";
import { coreEvlogMiddleware } from "@/lib/evlog";
import type { EnvVariables } from "@/lib/hono";
import { incrementRedisRateLimit } from "@/lib/redis-rate-limit";
import { writeTalkingVideoScripts } from "@/services/talking-video-scripts.service";
import { coreLogEvents, expectCoreLog } from "@/test/core-log";
import mount from "./talking-video-scripts-post";

vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: vi.fn(),
}));
vi.mock("@/services/talking-video-scripts.service", () => ({
  writeTalkingVideoScripts: vi.fn(),
}));
vi.mock("@sentry/node", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@sentry/node")>()),
  captureException: vi.fn(),
}));
vi.mock("@/lib/redis-rate-limit", () => ({
  incrementRedisRateLimit: vi.fn(),
}));

it("returns a 503 script budget refusal with only the shared alert", async () => {
  vi.mocked(incrementRedisRateLimit).mockResolvedValueOnce(1);
  vi.mocked(writeTalkingVideoScripts).mockImplementation(() =>
    rethrowAiGatewayFailure(
      Object.assign(new Error("Team budget exceeded"), {
        name: "GatewayInternalServerError",
      }),
    ),
  );
  expectCoreLog("error", "AI Gateway budget exhausted");
  const app = new OpenAPIHono<EnvVariables>();
  app.use(coreEvlogMiddleware());
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
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

  const response = await app.request(
    "/aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa/image-studio/talking-video-scripts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    },
  );

  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    kind: "ai_budget_exceeded",
    message:
      "Your assistant has reached its usage limit. It can respond again when the limit is raised or resets.",
  });
  expect(coreLogEvents()).toMatchObject([
    {
      status: 503,
      level: "error",
      error: { message: "AI Gateway budget exhausted" },
    },
  ]);
  expect(Sentry.captureException).not.toHaveBeenCalled();
});
