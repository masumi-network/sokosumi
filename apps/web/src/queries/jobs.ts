import type { Session } from "@sokosumi/utils";
import { queryOptions } from "@tanstack/react-query";
import { getJob } from "@/lib/actions/job";
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
    refetchOnWindowFocus: false,
    queryFn: async () => {
      if (!session) {
        throw new UnAuthenticatedError();
      }

      // `getJob` is a server action returning the core `Job` DTO. React's
      // RSC serializer transports its `Date` fields natively, so no superjson
      // round-trip is needed. It throws `UnAuthenticatedError` on 401 (which
      // this query relies on) and a generic `Error` otherwise.
      return await getJob({ jobId });
    },
  });
