import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoSeoSuggestionParamsSchema } from "@/schemas/cmo-seo.schema";
import { requestCmoArticleDraft } from "@/services/cmo-seo.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/seo/suggestions/{id}/draft",
  operationId: "requestCmoArticleDraftForProject",
  tags: ["CMO"],
  description:
    "Cuso writes the full article of one suggestion; it shows in the SEO tab when saved.",
  request: { params: cmoSeoSuggestionParamsSchema },
  responses: {
    200: jsonSuccessResponse(z.object({ turnId: z.string() }), "Cuso started"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("No such article"),
    409: jsonErrorResponse("Cuso is paused or out of credits"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    return ok(
      c,
      await requestCmoArticleDraft({ userId, projectId }, id).catch(rethrow),
    );
  });
}
