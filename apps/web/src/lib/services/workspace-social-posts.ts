import "server-only";

import type { SocialPostStatus } from "@sokosumi/core-client";
import { coreClient } from "@/lib/clients/core.client";
import { collectCursorPages } from "@/lib/utils/collect-cursor-pages";

const ATTENTION_PAGE_SIZE = 50;

/** Posts of every Project in the active workspace, newest change first. */
export async function listWorkspaceSocialPosts(
  statuses: readonly SocialPostStatus[],
  complete = false,
) {
  async function load(cursor?: string) {
    const response = await coreClient.getWorkspacesSocialPosts({
      status: statuses.join(","),
      limit: ATTENTION_PAGE_SIZE,
      ...(cursor && { cursor }),
    });
    return {
      items: response.data,
      nextCursor: response.meta?.pagination?.nextCursor,
    };
  }
  const first = await load();
  return {
    items: complete
      ? await collectCursorPages(first.items, first.nextCursor, load)
      : first.items,
    hasMore: !complete && Boolean(first.nextCursor),
  };
}
