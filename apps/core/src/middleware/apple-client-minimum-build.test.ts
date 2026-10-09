import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";

import {
  APPLE_CLIENT_HEADER,
  appleClientMinimumBuildMiddleware,
} from "./apple-client-minimum-build";

const { getEnvMock } = vi.hoisted(() => ({ getEnvMock: vi.fn() }));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));

function createApp() {
  const app = new Hono<{ Variables: { requestId: string } }>();
  app.use("*", async (c, next) => {
    c.set("requestId", "req_123");
    await next();
  });
  app.onError(errorHandler);
  app.use("*", appleClientMinimumBuildMiddleware());
  app.get("/", (c) => c.text("ok"));
  return app;
}

function request(headers: Record<string, string>) {
  return createApp().request("http://localhost/", { headers });
}

describe("appleClientMinimumBuildMiddleware", () => {
  beforeEach(() => {
    getEnvMock.mockReturnValue({ MACOS_MINIMUM_BUILD: 8000 });
  });

  it("answers 426 client_update_required with the download link below the minimum", async () => {
    const response = await request({
      [APPLE_CLIENT_HEADER]: "macos-developer-id/7999",
    });

    expect(response.status).toBe(426);
    const body = (await response.json()) as { kind: string; message: string };
    expect(body.kind).toBe("client_update_required");
    expect(body.message).toContain(
      "https://github.com/masumi-network/sokosumi/releases/download/macos-latest/Sokosumi.dmg",
    );
  });

  it("serves a build at the minimum", async () => {
    const response = await request({
      [APPLE_CLIENT_HEADER]: "macos-developer-id/8000",
    });

    expect(response.status).toBe(200);
  });

  it("no longer reads the retired app-store channel", async () => {
    const response = await request({
      [APPLE_CLIENT_HEADER]: "macos-app-store/39",
    });

    expect(response.status).toBe(200);
  });

  it("never gates build 1, the unpublished project default", async () => {
    const response = await request({
      [APPLE_CLIENT_HEADER]: "macos-developer-id/1",
    });

    expect(response.status).toBe(200);
  });

  it("serves every build while no minimum is set", async () => {
    getEnvMock.mockReturnValue({});

    const response = await request({
      [APPLE_CLIENT_HEADER]: "macos-developer-id/2",
    });

    expect(response.status).toBe(200);
  });

  it("gates a published build that predates the header by its User-Agent", async () => {
    const response = await request({
      "User-Agent": "Sokosumi/6362 CFNetwork/3860.100.1 Darwin/26.0.0",
    });

    expect(response.status).toBe(426);
  });

  it("leaves User-Agent builds below the first DMG alone, since they are local or TestFlight builds", async () => {
    const firstDMG = await request({
      "User-Agent": "Sokosumi/3125 CFNetwork/3860.100.1 Darwin/26.0.0",
    });
    expect(firstDMG.status).toBe(426);

    const beforeFirstDMG = await request({
      "User-Agent": "Sokosumi/3124 CFNetwork/3860.100.1 Darwin/26.0.0",
    });
    expect(beforeFirstDMG.status).toBe(200);
  });

  it("serves requests from other clients", async () => {
    const response = await request({
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    expect(response.status).toBe(200);
  });
});
