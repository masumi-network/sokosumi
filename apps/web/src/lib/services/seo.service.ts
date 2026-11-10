import "server-only";

import type {
  AddProjectSeoPageRequest,
  CreateProjectSeoActionTaskRequest,
  CreateProjectSeoMonitorRequest,
  CreateProjectSeoScopeRequest,
  CreateSeoAuditRequest,
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
  addSeoAuditPage,
  createProjectSeoActionTask,
  createProjectSeoMonitor,
  createProjectSeoScope,
  createSeoAudit,
  createSeoAuditActionTask,
  createSeoAuditMonitor,
  createSeoAuditScope,
  getProjectSeoWorkspace,
  getSeoAuditWorkspace,
  importProjectSeoAudit,
  importSeoAuditReport,
  listProjectSeoStatisticsProperties,
  listSeoAuditStatisticsProperties,
  listSeoAudits,
  recordProjectSeoPageChange,
  recordSeoAuditPageChange,
  requestProjectSeoAnalysis,
  requestSeoAuditAnalysis,
  saveProjectSeoCompetitor,
  saveProjectSeoKeyword,
  saveSeoAuditCompetitor,
  saveSeoAuditKeyword,
  syncProjectSeoStatistics,
  syncSeoAuditStatistics,
  updateProjectSeoScope,
  updateSeoAuditScope,
} from "@sokosumi/core-client";
import { withUnauthorizedCoreRedirect } from "@/lib/auth/handle-unauthorized-core-error";
import { createCoreGeneratedClient } from "@/lib/clients/core.client";
import { executeCoreOperation } from "@/lib/clients/core.request";
import type { SeoOwner } from "@/lib/seo/owner";

export type SeoWorkspaceQuery = NonNullable<
  GetProjectSeoWorkspaceData["query"]
>;

export const seoServiceNoRedirect = {
  async listAudits(
    query: { cursor?: string; limit?: number; projectId?: string } = {},
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => listSeoAudits({ client, query }),
      "Failed to load SEO audits",
    );
    return { audits: response.data, pagination: response.meta.pagination };
  },
  async createAudit(body: CreateSeoAuditRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) => createSeoAudit({ client, body }),
      "Failed to create SEO audit",
    );
    return response.data;
  },
  async getWorkspace(owner: SeoOwner, query: SeoWorkspaceQuery = {}) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? getSeoAuditWorkspace
          : getProjectSeoWorkspace)({ client, path: { id: owner.id }, query }),
      "Failed to load SEO workspace",
    );
    return response.data;
  },
  async addPage(owner: SeoOwner, body: AddProjectSeoPageRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit" ? addSeoAuditPage : addProjectSeoPage)({
          client,
          path: { id: owner.id },
          body,
        }),
      "Failed to add SEO page",
    );
    return response.data;
  },
  async createScope(owner: SeoOwner, body: CreateProjectSeoScopeRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit" ? createSeoAuditScope : createProjectSeoScope)({
          client,
          path: { id: owner.id },
          body,
        }),
      "Failed to create SEO scope",
    );
    return response.data;
  },
  async updateScope(
    owner: SeoOwner,
    scopeId: string,
    body: UpdateProjectSeoScopeRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit" ? updateSeoAuditScope : updateProjectSeoScope)({
          client,
          path: { id: owner.id, scopeId },
          body,
        }),
      "Failed to update SEO scope",
    );
    return response.data;
  },
  async importAudit(owner: SeoOwner, body: ImportProjectSeoAuditRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit" ? importSeoAuditReport : importProjectSeoAudit)(
          { client, path: { id: owner.id }, body },
        ),
      "Failed to import SEO audit",
    );
    return response.data;
  },
  async requestAnalysis(
    owner: SeoOwner,
    body: RequestProjectSeoAnalysisRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? requestSeoAuditAnalysis
          : requestProjectSeoAnalysis)({
          client,
          path: { id: owner.id },
          body,
        }),
      "Failed to request SEO analysis",
    );
    return response.data;
  },
  async saveKeyword(owner: SeoOwner, body: SaveProjectSeoKeywordRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit" ? saveSeoAuditKeyword : saveProjectSeoKeyword)({
          client,
          path: { id: owner.id },
          body,
        }),
      "Failed to save SEO keyword",
    );
    return response.data;
  },
  async saveCompetitor(owner: SeoOwner, body: SaveProjectSeoCompetitorRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? saveSeoAuditCompetitor
          : saveProjectSeoCompetitor)({ client, path: { id: owner.id }, body }),
      "Failed to save SEO competitor",
    );
    return response.data;
  },
  async createActionTask(
    owner: SeoOwner,
    body: CreateProjectSeoActionTaskRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? createSeoAuditActionTask
          : createProjectSeoActionTask)({
          client,
          path: { id: owner.id },
          body,
        }),
      "Failed to create SEO action task",
    );
    return response.data;
  },
  async recordPageChange(
    owner: SeoOwner,
    body: RecordProjectSeoPageChangeRequest,
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? recordSeoAuditPageChange
          : recordProjectSeoPageChange)({
          client,
          path: { id: owner.id },
          body,
        }),
      "Failed to record page change",
    );
    return response.data;
  },
  async createMonitor(owner: SeoOwner, body: CreateProjectSeoMonitorRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? createSeoAuditMonitor
          : createProjectSeoMonitor)({ client, path: { id: owner.id }, body }),
      "Failed to create SEO monitor",
    );
    return response.data;
  },
  async statisticsProperties(
    owner: SeoOwner,
    provider: "ga4" | "search_console",
  ) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? listSeoAuditStatisticsProperties
          : listProjectSeoStatisticsProperties)({
          client,
          path: { id: owner.id },
          query: { provider },
        }),
      "Failed to load SEO statistics properties",
    );
    return response.data;
  },
  async syncStatistics(owner: SeoOwner, body: SyncProjectSeoStatisticsRequest) {
    const response = await executeCoreOperation(
      createCoreGeneratedClient,
      (client) =>
        (owner.kind === "audit"
          ? syncSeoAuditStatistics
          : syncProjectSeoStatistics)({ client, path: { id: owner.id }, body }),
      "Failed to sync SEO statistics",
    );
    return response.data;
  },
};

export const seoService = withUnauthorizedCoreRedirect(seoServiceNoRedirect);
