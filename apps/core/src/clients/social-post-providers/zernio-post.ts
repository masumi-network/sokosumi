import { setTimeout as delay } from "node:timers/promises";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { z } from "zod";
import {
  ComposioPublishOutcomeUnknownError,
  ComposioToolError,
} from "@/clients/social-post-providers/tools";
import type {
  SocialPostPublishContext,
  SocialPostPublishResult,
} from "@/clients/social-post-providers/types";
import { ZernioApiError, zernioRequest } from "@/clients/zernio.client";

/**
 * Publishes one post to one Zernio account now and waits until the network
 * took it. The Zernio post id is the external id, which its analytics read by.
 * Once the create call left, a timeout is an unknown outcome: the post may
 * still go out, so a blind retry could publish twice.
 */
export async function publishZernioPost(input: {
  context: SocialPostPublishContext;
  accountId: string;
  platform: "tiktok" | "linkedin";
  /** The network's own host: a post address anywhere else is dropped. */
  urlHost: RegExp;
  toolSlug: string;
  refused: string;
  providerOutcome?: string;
  /** The post itself; the account, the time and the idempotency key are added here. */
  body: Record<string, unknown>;
}): Promise<SocialPostPublishResult> {
  const { context, accountId, platform } = input;
  const label = socialPostProviderLabel(platform);
  if (!context.postId)
    throw new Error(`${label} publishing requires a Social post ID`);
  const postResponse = z.object({
    post: z.object({
      _id: z.string().min(1),
      platforms: z.tuple([
        z.object({
          platform: z.literal(platform),
          accountId: z
            .union([
              z.string(),
              z.object({ _id: z.string() }).transform((account) => account._id),
            ])
            .optional(),
          status: z.string(),
          platformPostUrl: z
            .url({ protocol: /^https$/, hostname: input.urlHost })
            .nullish()
            .catch(null),
        }),
      ]),
    }),
  });

  let response: unknown;
  try {
    response = await zernioRequest("/posts", {
      method: "POST",
      idempotencyKey: context.postId,
      signal: context.signal,
      body: { publishNow: true, ...input.body },
    });
  } catch (error) {
    // A timeout or idempotency conflict can mean the original post is still publishing.
    if (
      error instanceof ZernioApiError &&
      error.status < 500 &&
      error.status !== 408 &&
      error.status !== 409
    ) {
      throw new ComposioToolError({
        message: `${input.refused} (HTTP ${error.status})`,
      });
    }
    throw new ComposioPublishOutcomeUnknownError(label);
  }

  for (;;) {
    const result = postResponse.safeParse(response);
    if (!result.success) throw new ComposioPublishOutcomeUnknownError(label);
    const {
      _id,
      platforms: [entry],
    } = result.data.post;
    if (entry.accountId && entry.accountId !== accountId)
      throw new ComposioPublishOutcomeUnknownError(label);
    if (entry.status === "published") {
      return {
        externalId: _id,
        publishedUrl: entry.platformPostUrl ?? null,
        ...(input.providerOutcome && {
          providerOutcome: input.providerOutcome,
        }),
        toolSlug: input.toolSlug,
      };
    }
    if (entry.status === "failed" || entry.status === "cancelled") {
      throw new ComposioToolError({ message: input.refused });
    }
    if (!["pending", "uploading", "processing"].includes(entry.status)) {
      throw new ComposioPublishOutcomeUnknownError(label);
    }
    try {
      await delay(5_000, undefined, { signal: context.signal });
      response = await zernioRequest(`/posts/${encodeURIComponent(_id)}`, {
        signal: context.signal,
      });
    } catch {
      throw new ComposioPublishOutcomeUnknownError(label);
    }
  }
}
