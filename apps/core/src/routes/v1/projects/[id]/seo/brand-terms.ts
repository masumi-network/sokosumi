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
  seoProjectParamsSchema,
} from "@/schemas/project-seo.schema";
import { saveSeoBrandTermsSchema } from "@/schemas/project-seo-traffic.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
import { saveProjectSeoBrandTerms } from "@/services/project-seo-settings.service";

/** The owner's brand term list for the branded and non-branded query split. A save replaces the whole list. */
export function createSeoBrandTermsRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "put",
        path: "/brand-terms",
        operationId:
          ownerKind === "audit"
            ? "saveSeoAuditBrandTerms"
            : "saveProjectSeoBrandTerms",
        tags: ownerKind === "audit" ? ["SEO"] : ["Projects"],
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: {
              "application/json": { schema: saveSeoBrandTermsSchema },
            },
            required: true,
          },
        },
        responses: {
          200: jsonSuccessResponse(
            projectSeoWorkspaceSchema,
            "Project SEO workspace",
          ),
          400: jsonErrorResponse("Invalid brand terms"),
          401: jsonErrorResponse("Unauthorized"),
          403: jsonErrorResponse("Forbidden"),
          404: jsonErrorResponse("Not found"),
          409: jsonErrorResponse("Conflicting brand terms"),
        },
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await saveProjectSeoBrandTerms(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );
  return app;
}
