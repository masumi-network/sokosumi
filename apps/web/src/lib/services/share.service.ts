import "server-only";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

export const shareService = (() => {
  async function getPubliclySharedResource(token: string) {
    try {
      return await coreClient.getSharedResourceByToken(token);
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  }

  return {
    getPubliclySharedResource,
  };
})();
