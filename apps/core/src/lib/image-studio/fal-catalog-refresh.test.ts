import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The one rule this module has: a refresh failure keeps serving the last good
 * catalog and never empties the studio.
 *
 * Everything below is a way for the refresh to go wrong — no key, an unreachable
 * provider, a crawl that produced nothing, a Redis that throws — and the
 * assertion is always the same: the catalog is still there.
 */

const { getEnvMock, redisMock, fetchSourcesMock, fetchVideoSourcesMock } =
  vi.hoisted(() => ({
    getEnvMock: vi.fn(),
    redisMock: vi.fn(),
    fetchSourcesMock: vi.fn(),
    fetchVideoSourcesMock: vi.fn(),
  }));

vi.mock("@/config/env", () => ({ getEnv: getEnvMock }));
vi.mock("@/lib/redis", () => ({ getRedisClient: redisMock }));
vi.mock("./fal-catalog-fetch", async () => ({
  ...(await vi.importActual<typeof import("./fal-catalog-fetch")>(
    "./fal-catalog-fetch",
  )),
  fetchFalCatalogSources: fetchSourcesMock,
}));
vi.mock("./fal-video-catalog-fetch", async () => ({
  ...(await vi.importActual<typeof import("./fal-video-catalog-fetch")>(
    "./fal-video-catalog-fetch",
  )),
  fetchFalVideoCatalogSources: fetchVideoSourcesMock,
}));

import { getImageCatalog } from "./catalog";
import {
  ensureImageCatalogFresh,
  refreshImageCatalog,
  resetImageCatalogFreshness,
} from "./fal-catalog-refresh";
import { getVideoCatalog } from "./video-catalog";

/** The snapshot's own size, which is what "still there" has to mean. */
const SNAPSHOT_MODEL_COUNT = getImageCatalog().models.length;
const SNAPSHOT_VIDEO_MODEL_COUNT = getVideoCatalog().models.length;

beforeEach(() => {
  vi.clearAllMocks();
  resetImageCatalogFreshness();
  getEnvMock.mockReturnValue({ FAL_KEY: "k" });
  redisMock.mockReturnValue(null);
  fetchVideoSourcesMock.mockRejectedValue(new Error("fal returned 429"));
});

describe("refreshImageCatalog", () => {
  it("keeps the last good catalog when fal cannot be reached", async () => {
    fetchSourcesMock.mockRejectedValue(new Error("fal returned 429"));

    expect(await refreshImageCatalog()).toBe(false);
    expect(getImageCatalog().models).toHaveLength(SNAPSHOT_MODEL_COUNT);
    expect(getImageCatalog().refreshedAt).toBeNull();
  });

  it("keeps the last good catalog when the crawl produced nothing usable", async () => {
    // Every endpoint excluded. That is a broken crawl, not news, and adopting it
    // would leave the studio with no models to offer.
    fetchSourcesMock.mockResolvedValue({
      models: [],
      prices: new Map(),
      schemas: new Map(),
      editEndpoints: new Set(),
      fetchedAt: "2026-09-28T00:00:00.000Z",
    });

    expect(await refreshImageCatalog()).toBe(false);
    expect(getImageCatalog().models).toHaveLength(SNAPSHOT_MODEL_COUNT);
  });

  it("does not call fal at all without a key, and does not treat that as an incident", async () => {
    getEnvMock.mockReturnValue({});

    expect(await refreshImageCatalog()).toBe(false);
    expect(fetchSourcesMock).not.toHaveBeenCalled();
    expect(getImageCatalog().models).toHaveLength(SNAPSHOT_MODEL_COUNT);
  });

  it("crawls fal once however many callers arrive together", async () => {
    let release: (() => void) | undefined;
    fetchSourcesMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              models: [],
              prices: new Map(),
              schemas: new Map(),
              editEndpoints: new Set(),
              fetchedAt: "2026-09-28T00:00:00.000Z",
            });
        }),
    );

    const calls = [
      refreshImageCatalog(),
      refreshImageCatalog(),
      refreshImageCatalog(),
    ];
    // The video crawl runs first, so the image crawl starts a tick later.
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.();
    await Promise.all(calls);

    // Three instances each crawling the whole catalog is how a deploy earns a
    // rate limit.
    expect(fetchSourcesMock).toHaveBeenCalledOnce();
  });
});

describe("ensureImageCatalogFresh", () => {
  it("never crawls fal, whatever the shared cache says", async () => {
    // The preview defect: this used to start a detached crawl on a miss, which a
    // serverless invocation always killed — logging a timeout on every cold start
    // and never once filling the layer it was trying to fill. The crawl belongs to
    // the script and the cron sync route, both of which own a whole process.
    redisMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
    });

    await ensureImageCatalogFresh();

    expect(fetchSourcesMock).not.toHaveBeenCalled();
    expect(getImageCatalog().models).toHaveLength(SNAPSHOT_MODEL_COUNT);
  });

  it("adopts a catalog a sibling instance already shared, without touching fal", async () => {
    const shared = {
      fetchedAt: "2026-09-28T00:00:00.000Z",
      models: getImageCatalog().models,
    };
    const get = vi.fn(async (key: string) =>
      key === "image-studio:fal-catalog:v1" ? JSON.stringify(shared) : null,
    );
    redisMock.mockReturnValue({ get, set: vi.fn() });

    await ensureImageCatalogFresh();

    // One read for the image catalog, one for the video catalog.
    expect(get).toHaveBeenCalledTimes(2);
    expect(fetchSourcesMock).not.toHaveBeenCalled();
    expect(getImageCatalog().refreshedAt).toBe(shared.fetchedAt);
  });

  it("treats a shared cache that cannot be read as a miss, never an outage", async () => {
    redisMock.mockReturnValue({
      get: vi.fn().mockRejectedValue(new Error("connection refused")),
      set: vi.fn(),
    });

    await expect(ensureImageCatalogFresh()).resolves.toBeUndefined();
    expect(getImageCatalog().models).toHaveLength(SNAPSHOT_MODEL_COUNT);
  });

  it("ignores an empty shared entry rather than adopting an empty studio", async () => {
    redisMock.mockReturnValue({
      get: vi.fn().mockResolvedValue(JSON.stringify({ models: [] })),
      set: vi.fn(),
    });

    await ensureImageCatalogFresh();

    expect(getImageCatalog().models).toHaveLength(SNAPSHOT_MODEL_COUNT);
  });

  it("reads Redis at most once per TTL, even after a miss", async () => {
    const get = vi.fn().mockResolvedValue(null);
    redisMock.mockReturnValue({ get, set: vi.fn() });

    await ensureImageCatalogFresh();
    get.mockClear();
    // A miss must not make the next page load try again, and an unreachable Redis
    // must not turn every request into a failed connection.
    await ensureImageCatalogFresh();

    expect(get).not.toHaveBeenCalled();
  });
});

describe("a crawl that runs out of time", () => {
  it("is discarded rather than adopted, so no model is silently dropped", async () => {
    // A partial catalog is a catalog missing models, and adopting one would take
    // working models out of the composer until the next successful crawl.
    fetchSourcesMock.mockImplementation(async (options) => {
      options.shouldContinue?.();
      throw new Error("the catalog crawl ran out of time before it finished");
    });

    expect(await refreshImageCatalog({ shouldContinue: () => false })).toBe(
      false,
    );
    expect(getImageCatalog().models).toHaveLength(SNAPSHOT_MODEL_COUNT);
  });

  it("hands the budget check down to the fetcher", async () => {
    fetchSourcesMock.mockResolvedValue({
      models: [],
      prices: new Map(),
      schemas: new Map(),
      editEndpoints: new Set(),
      fetchedAt: "2026-09-28T00:00:00.000Z",
    });
    const shouldContinue = () => true;

    await refreshImageCatalog({ shouldContinue });

    expect(fetchSourcesMock).toHaveBeenCalledWith(
      expect.objectContaining({ shouldContinue }),
    );
  });
});

describe("the video catalog", () => {
  it("keeps the last good video catalog, and still crawls images, when the video crawl fails", async () => {
    fetchSourcesMock.mockRejectedValue(new Error("fal returned 429"));

    await refreshImageCatalog();

    expect(fetchVideoSourcesMock).toHaveBeenCalledOnce();
    expect(fetchSourcesMock).toHaveBeenCalledOnce();
    expect(getVideoCatalog().models).toHaveLength(SNAPSHOT_VIDEO_MODEL_COUNT);
  });

  it("crawls only the endpoints a person verified a price for", async () => {
    fetchSourcesMock.mockRejectedValue(new Error("fal returned 429"));

    await refreshImageCatalog();

    const wanted = fetchVideoSourcesMock.mock.calls[0]![1] as Set<string>;
    expect([...wanted]).toContain("minimax/h3-max-turbo/text-to-video");
    expect(wanted.size).toBe(SNAPSHOT_VIDEO_MODEL_COUNT);
  });

  it("adopts a video catalog a sibling instance already shared", async () => {
    const shared = {
      fetchedAt: "2026-10-25T00:00:00.000Z",
      models: getVideoCatalog().models.slice(0, 1),
    };
    redisMock.mockReturnValue({
      get: vi.fn(async (key: string) =>
        key === "image-studio:fal-video-catalog:v1"
          ? JSON.stringify(shared)
          : null,
      ),
      set: vi.fn(),
    });

    await ensureImageCatalogFresh();

    expect(getVideoCatalog().models.map((model) => model.id)).toEqual([
      shared.models[0]!.id,
    ]);
  });
});
