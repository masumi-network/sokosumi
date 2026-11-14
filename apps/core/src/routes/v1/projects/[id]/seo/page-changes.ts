import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import {
  projectSeoWorkspaceSchema,
  recordSeoPageChangeSchema,
  seoProjectParamsSchema,
} from "@/schemas/project-seo.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
import { recordProjectSeoPageChange } from "@/services/project-seo-page-changes.service";

export function createSeoPageChangesRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/page-changes",
        operationId:
          ownerKind === "audit"
            ? "recordSeoAuditPageChange"
            : "recordProjectSeoPageChange",
        tags: ownerKind === "audit" ? ["SEO"] : ["Projects"],
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: {
              "application/json": { schema: recordSeoPageChangeSchema },
            },
            required: true,
          },
        },
        responses: {
          200: jsonSuccessResponse(
            projectSeoWorkspaceSchema,
            "Project SEO workspace",
          ),
          400: jsonErrorResponse("Invalid page change"),
          401: jsonErrorResponse("Unauthorized"),
          403: jsonErrorResponse("Forbidden"),
          404: jsonErrorResponse("Not found"),
          409: jsonErrorResponse("Conflicting page change"),
        },
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await recordProjectSeoPageChange(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );
  return app;
}
