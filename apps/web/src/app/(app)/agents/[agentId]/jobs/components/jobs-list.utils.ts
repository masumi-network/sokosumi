import type { JobSummary } from "@/lib/types/core-dto";

import { getDateGroupKey } from "@/lib/utils";

export interface JobsByDayGroup {
  key: string;
  jobs: JobSummary[];
}

export function buildJobDayGroups(
  jobs: JobSummary[],
  locale: string,
): JobsByDayGroup[] {
  const sortedJobs = [...jobs].sort(
    (firstJob, secondJob) =>
      new Date(secondJob.createdAt).getTime() -
      new Date(firstJob.createdAt).getTime(),
  );

  const groupsMap = new Map<string, JobSummary[]>();
  for (const job of sortedJobs) {
    const groupKey =
      getDateGroupKey(new Date(job.createdAt).getTime(), locale) ?? "";
    const current = groupsMap.get(groupKey);
    if (current) {
      current.push(job);
    } else {
      groupsMap.set(groupKey, [job]);
    }
  }

  return Array.from(groupsMap, ([key, groupedJobs]) => ({
    key,
    jobs: groupedJobs,
  }));
}
