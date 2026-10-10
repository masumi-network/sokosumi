"use server";

import { z } from "zod";
import { refreshProjectSocialAccountStatistics } from "@/lib/actions/project/action";

const refreshStatisticsInputSchema = z.object({
  projectId: z.string(),
  connectionId: z.string(),
});

/**
 * Queue a background refresh. Never waits on providers.
 */
export async function refreshSocialAccountPerformance(
  input: z.infer<typeof refreshStatisticsInputSchema>,
) {
  const parsed = refreshStatisticsInputSchema.parse(input);
  const result = await refreshProjectSocialAccountStatistics(parsed);
  if (!result.ok) {
    throw new Error(result.error.message ?? "Failed to enqueue refresh");
  }
  return { success: true as const };
}
