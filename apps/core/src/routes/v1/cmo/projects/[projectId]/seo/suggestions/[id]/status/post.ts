import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoSeoSuggestionParamsSchema,
  cmoSeoSuggestionSchema,
  cmoSeoSuggestionStatusRequestSchema,
} from "@/schemas/cmo-seo.schema";
import { setCmoSeoSuggestionStatus } from "@/services/cmo-seo.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/seo/suggestions/{id}/status",
  operationId: "setCmoSeoSuggestionStatusForProject",
  tags: ["CMO"],
  description:
    "Marks a page change or article done (the next weekly audit checks a page change), dismisses it, or opens it again.",
  request: {
    params: cmoSeoSuggestionParamsSchema,
    body: {
      content: {
        "application/json": { schema: cmoSeoSuggestionStatusRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoSeoSuggestionSchema, "The suggestion"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("No such suggestion"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    return ok(
      c,
      await setCmoSeoSuggestionStatus({ userId, projectId }, id, status).catch(
        rethrow,
      ),
    );
  });
}
