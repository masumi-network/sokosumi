import { HTTPException } from "hono/http-exception";

import { internalServerError } from "@/helpers/error";

export function mapSocialPostServiceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  throw internalServerError("Unable to manage social posts.");
}

export function presentSocialPost<
  T extends {
    canPublishNow: boolean;
    canApprove: boolean;
    canReject: boolean;
  },
>(post: T, coworkerId?: string): T {
  const human = coworkerId == null;
  return {
    ...post,
    canPublishNow: post.canPublishNow && human,
    canApprove: post.canApprove && human,
    canReject: post.canReject && human,
  };
}
