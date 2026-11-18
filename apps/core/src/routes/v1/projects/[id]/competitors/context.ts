import { projectCompetitorsSchema } from "@/schemas/project-competitors.schema";
import { getProjectCompetitors } from "@/services/competitors-overview.service";

/** A Project's Competitors page, as the API returns it. */
export async function competitorsResponse(projectId: string) {
  return projectCompetitorsSchema.parse(await getProjectCompetitors(projectId));
}
