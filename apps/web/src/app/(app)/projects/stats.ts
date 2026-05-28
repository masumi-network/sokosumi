import type { ProjectStatsEntry } from "@/lib/clients/generated/core/types.gen";

export function buildStatsByProjectId(stats: ProjectStatsEntry[]) {
  return Object.fromEntries(
    stats.map((entry) => [entry.projectId, entry]),
  ) as Record<string, ProjectStatsEntry>;
}
