import "server-only";

import type {
  AddProjectSeoPageRequest,
  CreateProjectSeoActionTaskRequest,
  CreateProjectSeoMonitorRequest,
  CreateProjectSeoScopeRequest,
  GetProjectSeoWorkspaceData,
  ImportProjectSeoAuditRequest,
  RecordProjectSeoPageChangeRequest,
  RequestProjectSeoAnalysisRequest,
  SaveProjectSeoCompetitorRequest,
  SaveProjectSeoKeywordRequest,
  SyncProjectSeoStatisticsRequest,
  UpdateProjectSeoScopeRequest,
} from "@sokosumi/core-client";
import {
  addProjectSeoPage,
  createProjectSeoActionTask,
  createProjectSeoMonitor,
  createProjectSeoScope,
  getProjectSeoWorkspace,
  importProjectSeoAudit,
  listProjectSeoStatisticsProperties,
  recordProjectSeoPageChange,
  requestProjectSeoAnalysis,
  saveProjectSeoCompetitor,
  saveProjectSeoKeyword,
  syncProjectSeoStatistics,
  updateProjectSeoScope,
} from "@sokosumi/core-client";
import { withUnauthorizedCoreRedirect } from "@/lib/auth/handle-unauthorized-core-error";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";

export type SeoWorkspaceQuery = NonNullable<
  GetProjectSeoWorkspaceData["query"]
>;

export const seoServiceNoRedirect = {
  async getWorkspace(projectId: string, query: SeoWorkspaceQuery = {}) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        getProjectSeoWorkspace({ client, path: { id: projectId }, query }),
      "Failed to load SEO workspace",
    );
    return response.data;
  },
  async addPage(projectId: string, body: AddProjectSeoPageRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => addProjectSeoPage({ client, path: { id: projectId }, body }),
      "Failed to add SEO page",
    );
    return response.data;
  },
  async createScope(projectId: string, body: CreateProjectSeoScopeRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        createProjectSeoScope({ client, path: { id: projectId }, body }),
      "Failed to create SEO scope",
    );
    return response.data;
  },
  async updateScope(
    projectId: string,
    scopeId: string,
    body: UpdateProjectSeoScopeRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        updateProjectSeoScope({
          client,
          path: { id: projectId, scopeId },
          body,
        }),
      "Failed to update SEO scope",
    );
    return response.data;
  },
  async importAudit(projectId: string, body: ImportProjectSeoAuditRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        importProjectSeoAudit({ client, path: { id: projectId }, body }),
      "Failed to import SEO audit",
    );
    return response.data;
  },
  async requestAnalysis(
    projectId: string,
    body: RequestProjectSeoAnalysisRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        requestProjectSeoAnalysis({ client, path: { id: projectId }, body }),
      "Failed to request SEO analysis",
    );
    return response.data;
  },
  async saveKeyword(projectId: string, body: SaveProjectSeoKeywordRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        saveProjectSeoKeyword({ client, path: { id: projectId }, body }),
      "Failed to save SEO keyword",
    );
    return response.data;
  },
  async saveCompetitor(
    projectId: string,
    body: SaveProjectSeoCompetitorRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        saveProjectSeoCompetitor({ client, path: { id: projectId }, body }),
      "Failed to save SEO competitor",
    );
    return response.data;
  },
  async createActionTask(
    projectId: string,
    body: CreateProjectSeoActionTaskRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        createProjectSeoActionTask({ client, path: { id: projectId }, body }),
      "Failed to create SEO action task",
    );
    return response.data;
  },
  async recordPageChange(
    projectId: string,
    body: RecordProjectSeoPageChangeRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        recordProjectSeoPageChange({ client, path: { id: projectId }, body }),
      "Failed to record page change",
    );
    return response.data;
  },
  async createMonitor(projectId: string, body: CreateProjectSeoMonitorRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        createProjectSeoMonitor({ client, path: { id: projectId }, body }),
      "Failed to create SEO monitor",
    );
    return response.data;
  },
  async statisticsProperties(
    projectId: string,
    provider: "ga4" | "search_console",
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        listProjectSeoStatisticsProperties({
          client,
          path: { id: projectId },
          query: { provider },
        }),
      "Failed to load SEO statistics properties",
    );
    return response.data;
  },
  async syncStatistics(
    projectId: string,
    body: SyncProjectSeoStatisticsRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        syncProjectSeoStatistics({ client, path: { id: projectId }, body }),
      "Failed to sync SEO statistics",
    );
    return response.data;
  },
};

export const seoService = withUnauthorizedCoreRedirect(seoServiceNoRedirect);
