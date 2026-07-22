import "server-only";

import { cache } from "react";

import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

/**
 * Public share reads are request-deduped with React `cache()` so
 * `generateMetadata` and the page share one Core round-trip (LCP/TTFB on
 * `/share/[token]`).
 */
export const shareService = (() => {
  const getPubliclySharedResource = cache(async (token: string) => {
    try {
      return await coreClient.getSharedResourceByToken(token);
    } catch (error) {
      if (error instanceof CoreApiRequestError && error.status === 404) {
        return null;
      }

      throw error;
    }
  });

  return {
    getPubliclySharedResource,
  };
})();
