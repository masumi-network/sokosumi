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
 * Error contract: no session / Core 401 throws `UnAuthenticatedError`, Core
 * 403/404 throws a not-found `Error`, any other failure rethrows. Note that in
 * production Next.js masks server-action errors (generic message + digest), so
 * the error TYPE does not survive to the client — unlike the HTTP status of
 * the route this replaces. That is fine for this consumer: the queryFn's own
 * session pre-check covers the visible unauthenticated path, and the job query
 * surfaces `data`, not errors.
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
