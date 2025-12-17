import { JobWithSokosumiStatus } from "@sokosumi/database";
import { queryOptions } from "@tanstack/react-query";
import superJson from "superjson";

import { apiSuccessResponseSchema } from "@/lib/api/schemas";
import { Session } from "@/lib/auth/auth";
import { UnAuthenticatedError } from "@/lib/auth/errors";

export const getJobQueryKey = (jobId: string) => ["jobs", jobId];

/**
 * Tanstack query options to get the job by job id.
 * This function must be called from a client component (e.g. with `useQuery` hook from tanstack query)
 *
 * @param jobId - The ID of the job to fetch
 * @param session - The session to use to fetch the job
 * @returns The query options for the job
 */
export const getJobQueryOptions = (jobId: string, session: Session | null) =>
  queryOptions({
    queryKey: getJobQueryKey(jobId),
    queryFn: async () => {
      if (!session) {
        throw new UnAuthenticatedError();
      }

      const url = new URL(
        `/api/internal/jobs/${jobId}`,
        window.location.origin,
      );
      const response = await fetch(url);
      if (!response.ok) {
        switch (response.status) {
          case 401:
            throw new UnAuthenticatedError();
          default:
            throw new Error(`Failed to fetch job: ${response.statusText}`);
        }
      }
      const parsedResponse = apiSuccessResponseSchema.parse(
        await response.json(),
      );
      const job = superJson.parse<JobWithSokosumiStatus>(parsedResponse.data);
      return job;
    },
  });
