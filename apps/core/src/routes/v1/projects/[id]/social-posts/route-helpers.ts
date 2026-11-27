import { HTTPException } from "hono/http-exception";

import { internalServerError } from "@/helpers/error";

export function mapSocialPostServiceError(error: unknown): never {
  if (error instanceof HTTPException) throw error;
  throw internalServerError("Unable to manage social posts.");
}

/** The post on Project Social, where a person approves it (ADR 0077). */
export function socialPostWebPath(projectId: string, postId: string): string {
  return `/social?${new URLSearchParams({ projectId, postId })}`;
}

export function presentSocialPost<
  T extends {
    canPublishNow: boolean;
    canApprove: boolean;
    canReject: boolean;
  },
>(post: T, actor?: { agent: boolean }): T {
  const human = !actor?.agent;
  return {
    ...post,
    canPublishNow: post.canPublishNow && human,
    canApprove: post.canApprove && human,
    canReject: post.canReject && human,
  };
}
