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
import pageChanges from "./page-changes";
import statistics from "./statistics";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
const responses = {
  200: jsonSuccessResponse(projectSeoWorkspaceSchema, "Project SEO workspace"),
  400: jsonErrorResponse("Invalid SEO request"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not found"),
  409: jsonErrorResponse("Concurrent edit or conflicting request"),
  422: jsonErrorResponse("Invalid report or request"),
};
const tags = ["Projects"];

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "get",
      path: "/",
      operationId: "getProjectSeoWorkspace",
      tags,
      request: {
        params: seoProjectParamsSchema,
        query: seoWorkspaceQuerySchema,
      },
      responses,
    }),
  ),
  async (c) => {
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    return ok(c, await getProjectSeoWorkspace(actor, c.req.valid("query")));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/pages",
      operationId: "addProjectSeoPage",
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
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await addProjectSeoPage(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/scopes",
      operationId: "createProjectSeoScope",
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
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await createProjectSeoScope(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "put",
      path: "/scopes/{scopeId}",
      operationId: "updateProjectSeoScope",
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
    const actor = requireSeoRouteActor(c.var, id);
    await updateProjectSeoScope(actor, scopeId, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/imports",
      operationId: "importProjectSeoAudit",
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
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await importProjectSeoAudit(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/analyses",
      operationId: "requestProjectSeoAnalysis",
      tags,
      request: {
        params: seoProjectParamsSchema,
        body: {
          content: { "application/json": { schema: requestSeoAnalysisSchema } },
          required: true,
        },
      },
      responses,
    }),
  ),
  async (c) => {
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await requestProjectSeoAnalysis(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/keywords",
      operationId: "saveProjectSeoKeyword",
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
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await saveProjectSeoKeyword(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/competitors",
      operationId: "saveProjectSeoCompetitor",
      tags,
      request: {
        params: seoProjectParamsSchema,
        body: {
          content: { "application/json": { schema: saveSeoCompetitorSchema } },
          required: true,
        },
      },
      responses,
    }),
  ),
  async (c) => {
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await saveProjectSeoCompetitor(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/actions",
      operationId: "createProjectSeoActionTask",
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
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await createProjectSeoActionTask(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/monitors",
      operationId: "createProjectSeoMonitor",
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
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await createProjectSeoMonitor(c.var, actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);

app.route("/statistics", statistics);
app.route("/", pageChanges);
export default app;
