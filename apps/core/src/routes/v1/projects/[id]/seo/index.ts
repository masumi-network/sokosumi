import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  addSeoPageSchema,
  createSeoActionTaskSchema,
  createSeoMonitorSchema,
  createSeoScopeSchema,
  importSeoAuditSchema,
  projectSeoWorkspaceSchema,
  requestSeoAnalysisSchema,
  saveSeoCompetitorSchema,
  saveSeoKeywordSchema,
  seoProjectParamsSchema,
  seoScopeParamsSchema,
  seoWorkspaceQuerySchema,
  updateSeoScopeSchema,
} from "@/schemas/project-seo.schema";
import {
  addProjectSeoPage,
  createProjectSeoScope,
  getProjectSeoWorkspace,
  saveProjectSeoCompetitor,
  saveProjectSeoKeyword,
  updateProjectSeoScope,
} from "@/services/project-seo.service";
import { importProjectSeoAudit } from "@/services/project-seo-import.service";
import { createProjectSeoMonitor } from "@/services/project-seo-monitor.service";
import {
  createProjectSeoActionTask,
  requestProjectSeoAnalysis,
} from "@/services/project-seo-operations.service";
import { createSeoBrandTermsRouter } from "./brand-terms";
import { createSeoPageChangesRouter } from "./page-changes";
import { createSeoStatisticsRouter } from "./statistics";

export function createSeoWorkspaceRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  const responses = {
    200: jsonSuccessResponse(
      projectSeoWorkspaceSchema,
      "Project SEO workspace",
    ),
    400: jsonErrorResponse("Invalid SEO request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not found"),
    409: jsonErrorResponse("Concurrent edit or conflicting request"),
    422: jsonErrorResponse("Invalid report or request"),
  };
  const tags = ownerKind === "audit" ? ["SEO"] : ["Projects"];
  const operation = (project: string, audit: string) =>
    ownerKind === "audit" ? audit : project;

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "get",
        path: "/",
        operationId: operation(
          "getProjectSeoWorkspace",
          "getSeoAuditWorkspace",
        ),
        tags,
        request: {
          params: seoProjectParamsSchema,
          query: seoWorkspaceQuerySchema,
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      return ok(c, await getProjectSeoWorkspace(actor, c.req.valid("query")));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/pages",
        operationId: operation("addProjectSeoPage", "addSeoAuditPage"),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: { "application/json": { schema: addSeoPageSchema } },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await addProjectSeoPage(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/scopes",
        operationId: operation("createProjectSeoScope", "createSeoAuditScope"),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: { "application/json": { schema: createSeoScopeSchema } },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await createProjectSeoScope(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "put",
        path: "/scopes/{scopeId}",
        operationId: operation("updateProjectSeoScope", "updateSeoAuditScope"),
        tags,
        request: {
          params: seoScopeParamsSchema,
          body: {
            content: { "application/json": { schema: updateSeoScopeSchema } },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const { id, scopeId } = c.req.valid("param");
      const actor = requireSeoRouteActor(c.var, { kind: ownerKind, id });
      await updateProjectSeoScope(actor, scopeId, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/imports",
        operationId: operation("importProjectSeoAudit", "importSeoAuditReport"),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: { "application/json": { schema: importSeoAuditSchema } },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await importProjectSeoAudit(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/analyses",
        operationId: operation(
          "requestProjectSeoAnalysis",
          "requestSeoAuditAnalysis",
        ),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: {
              "application/json": { schema: requestSeoAnalysisSchema },
            },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await requestProjectSeoAnalysis(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/keywords",
        operationId: operation("saveProjectSeoKeyword", "saveSeoAuditKeyword"),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: { "application/json": { schema: saveSeoKeywordSchema } },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await saveProjectSeoKeyword(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/competitors",
        operationId: operation(
          "saveProjectSeoCompetitor",
          "saveSeoAuditCompetitor",
        ),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: {
              "application/json": { schema: saveSeoCompetitorSchema },
            },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await saveProjectSeoCompetitor(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/actions",
        operationId: operation(
          "createProjectSeoActionTask",
          "createSeoAuditActionTask",
        ),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: {
              "application/json": { schema: createSeoActionTaskSchema },
            },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await createProjectSeoActionTask(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/monitors",
        operationId: operation(
          "createProjectSeoMonitor",
          "createSeoAuditMonitor",
        ),
        tags,
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: { "application/json": { schema: createSeoMonitorSchema } },
            required: true,
          },
        },
        responses,
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await createProjectSeoMonitor(c.var, actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );

  app.route("/statistics", createSeoStatisticsRouter(ownerKind));
  app.route("/", createSeoPageChangesRouter(ownerKind));
  app.route("/", createSeoBrandTermsRouter(ownerKind));
  return app;
}
export default createSeoWorkspaceRouter("project");
