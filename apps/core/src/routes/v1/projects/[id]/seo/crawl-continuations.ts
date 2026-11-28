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
import { requestSeoCrawlNextSchema } from "@/schemas/seo-audit-price.schema";
import { getProjectSeoWorkspace } from "@/services/project-seo.service";
import { requestSeoCrawlNext } from "@/services/seo-crawl-next.service";

/** Crawl the next pages of the newest site crawl, and audit the problem pages it finds. */
export function createSeoCrawlContinuationsRouter(
  ownerKind: "project" | "audit",
) {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "post",
        path: "/crawl-continuations",
        operationId:
          ownerKind === "audit"
            ? "requestSeoAuditCrawlContinuation"
            : "requestProjectSeoCrawlContinuation",
        tags: ownerKind === "audit" ? ["SEO"] : ["Projects"],
        request: {
          params: seoProjectParamsSchema,
          body: {
            content: {
              "application/json": { schema: requestSeoCrawlNextSchema },
            },
            required: true,
          },
        },
        responses: {
          200: jsonSuccessResponse(
            projectSeoWorkspaceSchema,
            "Project SEO workspace",
          ),
          400: jsonErrorResponse("Invalid crawl continuation"),
          401: jsonErrorResponse("Unauthorized"),
          403: jsonErrorResponse("Forbidden"),
          404: jsonErrorResponse("Not found"),
          409: jsonErrorResponse("The crawl cannot go on from this crawl"),
          422: jsonErrorResponse("Insufficient credits"),
        },
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      await requestSeoCrawlNext(actor, c.req.valid("json"));
      return ok(c, await getProjectSeoWorkspace(actor));
    },
  );
  return app;
}
