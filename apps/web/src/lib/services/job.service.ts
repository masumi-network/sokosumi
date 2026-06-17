import "server-only";

import { coreClient } from "@/lib/clients/core.client";

export const jobService = (() => {
  const moveJobToWorkspace = async (
    jobId: string,
    organizationId: string | null,
  ) => {
    const result = await coreClient.moveJobToWorkspace(jobId, {
      organizationId,
    });

    if (!result.data) {
      throw new Error("Failed to move job to workspace");
    }

    return result.data;
  };

  return {
    moveJobToWorkspace,
  };
})();
