import { createHash } from "node:crypto";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";

type Episode = Pick<
  NonNullable<ProjectSeoWorkspace["actions"][number]["followUpReview"]>,
  "kind" | "period" | "baselineObservationId" | "observationId"
>;

/** Both observations are immutable. The later ID identifies the first measurement in the current episode. */
export function recommendationEpisodeKey(actionId: string, review: Episode) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        actionId,
        review.kind,
        review.period ?? null,
        review.baselineObservationId,
        review.observationId,
      ]),
    )
    .digest("hex");
}
