import { createRoute, z } from "@hono/zod-openapi";

import {
  jsonErrorResponse,
  jsonPaginatedSuccessResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { requireSeoWorkspaceRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  projectSeoWorkspaceSchema,
  seoProjectParamsSchema,
} from "@/schemas/project-seo.schema";
import {
  createSeoAuditSchema,
  seoAuditListQuerySchema,
  seoAuditSummarySchema,
  seoAuditWorkspaceMappingSchema,
} from "@/schemas/seo-audit.schema";
import {
  createSeoAudit,
  getSeoAuditWorkspaceMapping,
  listSeoAudits,
} from "@/services/seo-audit.service";
import { createSeoWorkspaceRouter } from "../../projects/[id]/seo";
import chat from "./chat";

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
const errors = {
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not found"),
  409: jsonErrorResponse("Concurrent edit"),
  422: jsonErrorResponse("Invalid SEO audit request"),
};
app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "get",
      path: "/",
      operationId: "listSeoAudits",
      tags: ["SEO"],
      request: { query: seoAuditListQuerySchema },
      responses: {
        200: jsonPaginatedSuccessResponse(
          z.array(seoAuditSummarySchema),
          "Workspace SEO audits",
        ),
        ...errors,
      },
    }),
  ),
  async (c) => {
    const result = await listSeoAudits(
      requireSeoWorkspaceRouteActor(c.var),
      c.req.valid("query"),
    );
    return ok(c, result.audits, result.pagination);
  },
);
app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/",
      operationId: "createSeoAudit",
      tags: ["SEO"],
      request: {
        body: {
          content: { "application/json": { schema: createSeoAuditSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonSuccessResponse(
          projectSeoWorkspaceSchema,
          "Created SEO audit and first page",
        ),
        ...errors,
      },
    }),
  ),
  async (c) =>
    ok(
      c,
      await createSeoAudit(
        requireSeoWorkspaceRouteActor(c.var),
        c.req.valid("json"),
      ),
    ),
);
app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "get",
      path: "/{id}/workspace",
      operationId: "getSeoAuditWorkspaceMapping",
      description:
        "Resolve an SEO audit id to its workspace across the workspaces the user can use. For the web switch-workspace prompt. Coworkers and Soko Bots get 403. An audit the user cannot open after a switch is 404.",
      tags: ["SEO"],
      request: { params: seoProjectParamsSchema },
      responses: {
        200: jsonSuccessResponse(
          seoAuditWorkspaceMappingSchema,
          "SEO audit workspace mapping",
        ),
        ...errors,
      },
    }),
  ),
  // Not the active workspace's actor: the Audit is in another workspace of this user.
  async (c) =>
    ok(
      c,
      await getSeoAuditWorkspaceMapping(
        requireUserAuthContext(c.var.authContext).userId,
        c.req.valid("param").id,
      ),
    ),
);
app.route("/:id/chat", chat);
app.route("/:id", createSeoWorkspaceRouter("audit"));
export default app;
