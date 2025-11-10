import { JobWithStatus } from "@sokosumi/database";
import { queryOptions } from "@tanstack/react-query";
import superJson from "superjson";

import { getEnvPublicConfig } from "@/config/env.public";
import { apiSuccessResponseSchema } from "@/lib/api/schemas";
import { Session } from "@/lib/auth/auth";
import { UnAuthenticatedError } from "@/lib/auth/errors";

export const getJobQueryKey = (jobId: string) => ["jobs", jobId];

export const getJobQueryOptions = (jobId: string, session: Session | null) =>
  queryOptions({
    queryKey: getJobQueryKey(jobId),
    queryFn: async () => {
      if (!session) {
        throw new UnAuthenticatedError();
      }

      const url = new URL(
        `/api/v1/jobs/${jobId}`,
        getEnvPublicConfig().NEXT_PUBLIC_SOKOSUMI_URL,
      );
      const response = await fetch(url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.session.token}`,
        },
      });
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
      const job = superJson.parse<JobWithStatus>(parsedResponse.data);
      return job;
    },
  });
