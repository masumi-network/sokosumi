import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { classify, fixture, acquire, release, pending, env } = vi.hoisted(
  () => ({
    classify: vi.fn(),
    fixture: vi.fn(),
    acquire: vi.fn(),
    release: vi.fn(),
    pending: [] as Promise<unknown>[],
    env: {
      VERCEL_ENV: "preview",
      CRON_SECRET: "test-secret",
      LOCK_TIMEOUT: 5000,
      LOCK_TIMEOUT_BUFFER: 1000,
    },
  }),
);
vi.mock("@/config/env", () => ({ getEnv: () => env }));
vi.mock("@/services/task-tag-classification.service", () => ({
  classifyPendingTaskTags: classify,
  classifyFixtureTaskTags: fixture,
}));
vi.mock("@/services/sync-lock.service", () => ({
  syncLockService: { acquireLock: acquire, releaseLock: release },
}));
vi.mock("@vercel/functions", () => ({
  waitUntil: (work: Promise<unknown>) => pending.push(work),
}));

import mount from "./get";

const taskId = "00000000-0000-4000-8000-000000000001";
const query = `fixtureTaskId=${taskId}&fixtureOwnerId=fixture-owner`;
const headers = { authorization: "Bearer test-secret" };
function app() {
  const instance = new Hono();
  mount(instance);
  return instance;
}

beforeEach(() => {
  vi.resetAllMocks();
  pending.length = 0;
  env.VERCEL_ENV = "preview";
  acquire.mockResolvedValue({
    key: "task-tag-classification",
    ownerToken: "owner",
  });
  release.mockResolvedValue(true);
  classify.mockResolvedValue(undefined);
  fixture.mockResolvedValue(undefined);
});

describe("task tag sync", () => {
  it.each([undefined, "Bearer wrong"])(
    "requires cron auth for scoped runs: %s",
    async (authorization) => {
      const response = await app().request(`/task-tags?${query}`, {
        headers: authorization ? { authorization } : {},
      });
      expect(response.status).toBe(401);
      expect(acquire).not.toHaveBeenCalled();
      expect(fixture).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    },
  );

  it("executes only the fixture worker under the existing sync lock", async () => {
    expect(
      (await app().request(`/task-tags?${query}`, { headers })).status,
    ).toBe(200);
    await Promise.all(pending);
    expect(fixture).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
      { taskId, ownerId: "fixture-owner" },
    );
    expect(classify).not.toHaveBeenCalled();
    expect(acquire).toHaveBeenCalledWith("task-tag-classification");
    expect(release).toHaveBeenCalledWith("task-tag-classification", "owner");
  });

  it.each([
    `fixtureTaskId=${taskId}`,
    "fixtureOwnerId=fixture-owner",
    "fixtureTaskId=invalid&fixtureOwnerId=fixture-owner",
    `fixtureTaskId=${taskId}&fixtureOwnerId=`,
    `${query}&unexpected=true`,
    `${query}&fixtureTaskId=${taskId}`,
    `${query}&fixtureOwnerId=another-owner`,
  ])(
    "rejects invalid or partial scope without falling back: %s",
    async (invalidQuery) => {
      expect(
        (await app().request(`/task-tags?${invalidQuery}`, { headers })).status,
      ).toBe(400);
      expect(acquire).not.toHaveBeenCalled();
      expect(fixture).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    },
  );

  it.each(["production", "development"])(
    "rejects fixture scope in %s",
    async (environment) => {
      env.VERCEL_ENV = environment;
      expect(
        (await app().request(`/task-tags?${query}`, { headers })).status,
      ).toBe(403);
      expect(acquire).not.toHaveBeenCalled();
      expect(fixture).not.toHaveBeenCalled();
      expect(classify).not.toHaveBeenCalled();
    },
  );

  it("preserves normal cron processing without query parameters", async () => {
    env.VERCEL_ENV = "production";
    expect((await app().request("/task-tags", { headers })).status).toBe(200);
    await Promise.all(pending);
    expect(classify).toHaveBeenCalledTimes(1);
    expect(fixture).not.toHaveBeenCalled();
  });

  it("does no work when the shared lock is held", async () => {
    acquire.mockRejectedValue(new Error("LOCK_IS_LOCKED"));
    expect(
      (await app().request(`/task-tags?${query}`, { headers })).status,
    ).toBe(409);
    expect(fixture).not.toHaveBeenCalled();
    expect(classify).not.toHaveBeenCalled();
  });
});
