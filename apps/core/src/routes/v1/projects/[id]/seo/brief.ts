import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  OpenAPIHonoWithAuth,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { seoProjectParamsSchema } from "@/schemas/project-seo.schema";
import {
  saveSeoAuditBriefRequestSchema,
  seoAuditBriefSchema,
  seoBriefSuggestionQuery,
  seoBriefSuggestionSchema,
} from "@/schemas/seo-audit-brief.schema";
import {
  getSeoBrief,
  getSeoBriefSuggestion,
  saveSeoBrief,
} from "@/services/seo-audit-brief.service";

export function createSeoBriefRouter(ownerKind: "project" | "audit") {
  const app = new OpenAPIHonoWithAuth({ includeWorkspaceContext: true });
  const responses = {
    200: jsonSuccessResponse(
      seoAuditBriefSchema,
      "The requesting user's SEO brief",
    ),
    400: jsonErrorResponse("Invalid SEO brief"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("SEO collection or page not found"),
    409: jsonErrorResponse("The brief changed. Reload it before saving."),
  };
  const route = {
    path: "/brief",
    tags: ownerKind === "audit" ? ["SEO"] : ["Projects"],
    responses,
  };
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        ...route,
        method: "get",
        operationId:
          ownerKind === "audit" ? "getSeoAuditBrief" : "getProjectSeoBrief",
        request: { params: seoProjectParamsSchema },
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      c.header("Cache-Control", "private, no-store");
      return ok(c, await getSeoBrief(actor));
    },
  );
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        ...route,
        method: "put",
        operationId:
          ownerKind === "audit" ? "saveSeoAuditBrief" : "saveProjectSeoBrief",
        request: {
          params: seoProjectParamsSchema,
          body: {
            required: true,
            content: {
              "application/json": { schema: saveSeoAuditBriefRequestSchema },
            },
          },
        },
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      c.header("Cache-Control", "private, no-store");
      return ok(c, await saveSeoBrief(actor, c.req.valid("json")));
    },
  );
  app.openapi(
    withOrganizationSlugHeaderParameter(
      createRoute({
        method: "get",
        path: "/brief/suggestion",
        tags: route.tags,
        operationId:
          ownerKind === "audit"
            ? "getSeoAuditBriefSuggestion"
            : "getProjectSeoBriefSuggestion",
        request: {
          params: seoProjectParamsSchema,
          query: seoBriefSuggestionQuery,
        },
        responses: {
          200: jsonSuccessResponse(
            seoBriefSuggestionSchema,
            "A suggested page action, or null for manual selection",
          ),
          400: responses[400],
          401: responses[401],
          403: responses[403],
          404: responses[404],
        },
      }),
    ),
    async (c) => {
      const actor = requireSeoRouteActor(c.var, {
        kind: ownerKind,
        id: c.req.valid("param").id,
      });
      c.header("Cache-Control", "private, no-store");
      return ok(
        c,
        await getSeoBriefSuggestion(actor, c.req.valid("query").pageId),
      );
    },
  );
  return app;
}
