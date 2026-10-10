import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    }) => Promise<void>,
  ) => {
    seen.lockKey = lockKey;
    await operation({
      abortSignal: new AbortController().signal,
      deadlineMs: Date.now() + 60_000,
      msRemaining: () => 60_000,
      shouldContinue: () => true,
    });
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
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const app = new Hono();
    mountSyncSocialPostsPublish(app);
    const response = await app.request("http://localhost/social-posts-publish");

    expect(response.status).toBe(200);
    expect(seen.lockKey).toBe(SOCIAL_POSTS_PUBLISH_SYNC_LOCK_KEY);
    expect(seen.lockKey).toBe("social-posts-publish-sync");
    expect(publish).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      "[sync/social-posts-publish] Completed sync",
      { published: 2, failed: 1, skipped: 0 },
    );
    info.mockRestore();
  });
});
