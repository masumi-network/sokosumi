import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { coreLogEvents } from "@/test/core-log";

import mountSyncSocialPostsPublish, {
  SOCIAL_POSTS_PUBLISH_SYNC_LOCK_KEY,
} from "./get";

const publish = vi.hoisted(() => vi.fn());
const seen = vi.hoisted(() => ({ lockKey: "" }));

vi.mock("@/services/social-post-publisher.service", () => ({
  publishDueSocialPosts: publish,
}));

vi.mock("../handler.js", () => ({
  handleSyncRequest: async (
    c: { json: (body: unknown) => Response },
    lockKey: string,
    operation: (context: {
      abortSignal: AbortSignal;
      deadlineMs: number;
      msRemaining: () => number;
      shouldContinue: () => boolean;
      log: import("../handler.js").SyncRunContext["log"];
    }) => Promise<void>,
  ) => {
    // The run's event, as the real handler sends it when the run ends.
    const { createCoreLogger } = await import("@/lib/evlog");
    const log = createCoreLogger({ operation: "cron_sync" });
    seen.lockKey = lockKey;
    await operation({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      msRemaining: () => 60_000,
      shouldContinue: () => true,
      log,
    });
    log.emit();
    return c.json({ ok: true });
  },
}));

describe("GET /sync/social-posts-publish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seen.lockKey = "";
    publish.mockResolvedValue({ published: 2, failed: 1, skipped: 0 });
  });

  it("publishes due posts under the publish sync lock", async () => {
    const app = new Hono();
    mountSyncSocialPostsPublish(app);
    const response = await app.request("http://localhost/social-posts-publish");

    expect(response.status).toBe(200);
    expect(seen.lockKey).toBe(SOCIAL_POSTS_PUBLISH_SYNC_LOCK_KEY);
    expect(seen.lockKey).toBe("social-posts-publish-sync");
    expect(publish).toHaveBeenCalledOnce();
    expect(coreLogEvents()).toEqual([
      expect.objectContaining({
        operation: "cron_sync",
        result: { published: 2, failed: 1, skipped: 0 },
      }),
    ]);
  });
});
