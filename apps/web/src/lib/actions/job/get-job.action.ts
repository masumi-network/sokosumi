"use server";

import { UnAuthenticatedError } from "@/lib/auth/errors";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";
import type { Job } from "@/lib/clients/generated/core";
import {
  type AuthenticatedRequest,
  withSession,
} from "@/middleware/auth-middleware";

interface GetJobParameters extends AuthenticatedRequest {
  jobId: string;
}

/**
 * Server action to fetch a single job readable by the authenticated user.
 *
 * Consumed by the `getJobQueryOptions` TanStack `queryFn`. Returns the core
 * `Job` DTO as-is: the generated client transformers already revive its
 * `Date` fields, and React's RSC serializer transports them natively across
 * the server-action boundary.
 *
 * Error contract mirrors the route it replaces: no session / Core 401 throws
 * `UnAuthenticatedError` (the query relies on this), Core 403/404 throws a
 * not-found `Error`, and any other failure rethrows as a generic `Error`.
 */
export const getJob = withSession<GetJobParameters, Job>(async ({ jobId }) => {
  if (!jobId) {
    throw new Error("Invalid job id");
  }

  try {
    const response = await coreClient.getJobById(jobId);
    return response.data;
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      if (error.status === 401) {
        throw new UnAuthenticatedError();
      }
      if (error.status === 403 || error.status === 404) {
        throw new Error("Job not found");
      }
    }

    throw error;
  }
});
