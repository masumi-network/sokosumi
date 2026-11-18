import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { suggestTaskTags } from "./task-tag-suggestions.service";

const mocks = vi.hoisted(() => ({ redis: vi.fn(), catalog: vi.fn() }));
vi.mock("@/lib/redis", () => ({ getRedisClient: mocks.redis }));
vi.mock("@/helpers/task-tag-catalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/helpers/task-tag-catalog")>()),
  loadTaskTagCatalog: mocks.catalog,
}));
vi.mock("@/clients/task-tag-classifier", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/clients/task-tag-classifier")>()),
  taskTagProviderAvailable: async () => true,
  classifyTaskTags: async () => ({
    ok: true,
    tags: [],
    workspaceSuggestions: [],
  }),
}));

// An explicit disposable socket avoids all application Redis credentials.
const socket = process.env.TASK_TAG_ADMISSION_REDIS_SOCKET;
describe.skipIf(!socket)(
  "batched task tag admission against disposable Redis",
  () => {
    let redis: Redis;
    let keys: () => string[];
    beforeAll(async () => {
      redis = new Redis({
        path: socket,
        lazyConnect: true,
        maxRetriesPerRequest: 0,
      });
      await redis.connect();
      const script = vi.spyOn(redis, "eval");
      keys = () => [
        ...new Set(
          script.mock.calls.flatMap(([, count, ...args]) =>
            args.slice(0, Number(count)).map(String),
          ),
        ),
      ];
      mocks.redis.mockReturnValue(redis);
    });
    afterAll(async () => {
      const touched = keys();
      if (touched.length) await redis.del(...touched);
      await redis.quit();
    });
    it("large uncached drafts reserve an entire minute, even across workspaces", async () => {
      const userId = randomUUID();
      const scope = { userId, workspaceId: randomUUID() };
      const input = { name: "Evaluate a large workspace vocabulary" };
      mocks.catalog.mockResolvedValue(
        Array.from({ length: 250 }, (_, i) => ({
          id: randomUUID(),
          displayName: `Label ${i}`,
          color: null,
          description: null,
          vocabularyVersion: 1,
        })),
      );
      const first = await suggestTaskTags(scope, input);
      expect(await suggestTaskTags(scope, input)).toEqual(first);
      mocks.catalog.mockResolvedValue([]);
      // The single-request cooldown is only 5s. Charging all seven batches
      // exhausts the minute even when the next workspace needs just one batch.
      await expect(
        suggestTaskTags({ ...scope, workspaceId: randomUUID() }, input),
      ).rejects.toMatchObject({
        status: 429,
        cause: { retryAfterSeconds: expect.closeTo(60, -1) },
      });
    });
  },
);
