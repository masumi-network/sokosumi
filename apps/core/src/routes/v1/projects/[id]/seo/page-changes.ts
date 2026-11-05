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

const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/page-changes",
      operationId: "recordProjectSeoPageChange",
      tags: ["Projects"],
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
    const actor = requireSeoRouteActor(c.var, c.req.valid("param").id);
    await recordProjectSeoPageChange(actor, c.req.valid("json"));
    return ok(c, await getProjectSeoWorkspace(actor));
  },
);
export default app;
