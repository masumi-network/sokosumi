"use server";

import { z } from "zod";

const refreshStatisticsInputSchema = z.object({
  projectId: z.string(),
  connectionId: z.string(),
});

/**
 * Trigger an immediate background refresh for a social account.
 * Non-blocking - queues the work and returns immediately.
 * Safe to call on Performance tab mount when data is stale.
 */
export async function refreshSocialAccountPerformance(
  input: z.infer<typeof refreshStatisticsInputSchema>,
) {
  const parsed = refreshStatisticsInputSchema.parse(input);

  // Call the Core API endpoint that enqueues the background sync
  // This keeps web/ from importing core/ services directly
  const response = await fetch(
    `/api/projects/${encodeURIComponent(parsed.projectId)}/social-connections/${encodeURIComponent(parsed.connectionId)}/statistics/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    },
  );

  if (!response.ok) {
    throw new Error("Failed to enqueue refresh");
  }

  return { success: true };
}
