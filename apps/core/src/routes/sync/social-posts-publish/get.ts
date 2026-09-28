import type { Hono } from "hono";

import { publishDueSocialPosts } from "@/services/social-post-publisher.service";

import { handleSyncRequest } from "../handler.js";

export const SOCIAL_POSTS_PUBLISH_SYNC_LOCK_KEY = "social-posts-publish-sync";

export default function mount(app: Hono) {
  app.get("/social-posts-publish", async (c) => {
    return await handleSyncRequest(
      c,
      SOCIAL_POSTS_PUBLISH_SYNC_LOCK_KEY,
      async (context) => {
        const result = await publishDueSocialPosts({
          abortSignal: context.abortSignal,
          deadlineMs: context.deadlineMs,
          shouldContinue: context.shouldContinue,
        });

        console.info("[sync/social-posts-publish] Completed sync", result);
      },
    );
  });
}
