import "server-only";

import type {
  ProjectCompetitorCheckRun,
  ProjectCompetitorCreate,
  ProjectCompetitorSuggestions,
  ProjectCompetitors,
  ProjectCompetitorUpdate,
} from "@sokosumi/core-client";

import { coreClient } from "@/lib/clients/core.client";

/** A Project's competitor monitoring in Core: the page and every change to it. */
export const competitorsService = {
  async get(projectId: string): Promise<ProjectCompetitors> {
    return (await coreClient.getProjectCompetitors(projectId)).data;
  },
  async add(
    projectId: string,
    body: ProjectCompetitorCreate,
  ): Promise<ProjectCompetitors> {
    return (await coreClient.addProjectCompetitor(projectId, body)).data;
  },
  async update(
    projectId: string,
    competitorId: string,
    body: ProjectCompetitorUpdate,
  ): Promise<ProjectCompetitors> {
    return (
      await coreClient.updateProjectCompetitor(projectId, competitorId, body)
    ).data;
  },
  async remove(
    projectId: string,
    competitorId: string,
  ): Promise<ProjectCompetitors> {
    return (await coreClient.removeProjectCompetitor(projectId, competitorId))
      .data;
  },
  async setChecks(projectId: string, on: boolean): Promise<ProjectCompetitors> {
    return (await coreClient.setProjectCompetitorChecks(projectId, on)).data;
  },
  async runCheck(projectId: string): Promise<ProjectCompetitorCheckRun> {
    return (await coreClient.runProjectCompetitorCheck(projectId)).data;
  },
  /** Competitors to pick from, found from the Project's website. Adds none. */
  async suggest(
    projectId: string,
  ): Promise<ProjectCompetitorSuggestions["suggestions"]> {
    return (await coreClient.suggestProjectCompetitors(projectId)).data
      .suggestions;
  },
};
