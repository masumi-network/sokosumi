import "server-only";

import { coreClient } from "@/lib/clients/core.client";

const TASK_COUNT_THRESHOLD = 5;
const DEFAULT_FALLBACK = "/tasks";

/**
 * Get the default authenticated landing path based on user's task count.
 *
 * - Users with < 5 tasks → `/chat` (new users)
 * - Users with >= 5 tasks → `/tasks` (established users)
 * - On error → `/tasks` (safe fallback)
 *
 * This helper calls the Core API with `scope=all` so the count reflects
 * the user's total non-archived tasks across every workspace, not only
 * the active workspace.
 *
 * @returns Promise<string> - The landing path (`/chat` or `/tasks`)
 */
export async function getDefaultAuthenticatedLandingPath(): Promise<string> {
  try {
    const response = await coreClient.getUserTasksCount("me", { scope: "all" });

    if (response.data?.count !== undefined) {
      return response.data.count < TASK_COUNT_THRESHOLD ? "/chat" : "/tasks";
    }

    // If count is missing, fall back to default
    return DEFAULT_FALLBACK;
  } catch (_error) {
    // On any error (Core API down, network issue, auth failure), fall back to tasks
    return DEFAULT_FALLBACK;
  }
}
