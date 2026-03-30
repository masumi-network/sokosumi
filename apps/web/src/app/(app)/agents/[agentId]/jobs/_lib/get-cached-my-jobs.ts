import type { JobWithSokosumiStatus } from "@sokosumi/database";
import { cache } from "react";

import { userService } from "@/lib/services";

/**
 * Cached wrapper for userService.getMyJobs to deduplicate queries across parallel routes.
 * This prevents multiple database queries when layout and parallel route pages both need the same data.
 */
export const getCachedMyJobs = cache(
  async (agentId: string): Promise<JobWithSokosumiStatus[]> => {
    return userService.getMyJobs(agentId);
  },
);
