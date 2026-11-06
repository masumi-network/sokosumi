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
import { projectSeoWorkspaceSchema } from "@/schemas/project-seo.schema";
import {
  createSeoAuditSchema,
  seoAuditListQuerySchema,
  seoAuditSummarySchema,
} from "@/schemas/seo-audit.schema";
import { createSeoAudit, listSeoAudits } from "@/services/seo-audit.service";
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
app.route("/:id/chat", chat);
app.route("/:id", createSeoWorkspaceRouter("audit"));
export default app;
