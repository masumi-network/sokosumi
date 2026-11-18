import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { requestCmoArticleIdeas } from "@/services/cmo-seo.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/seo/ideas",
  operationId: "requestCmoArticleIdeasForProject",
  tags: ["CMO"],
  description:
    "More article ideas: Cuso researches keywords and saves new article suggestions; his answer lands in the chat.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(z.object({ turnId: z.string() }), "Cuso started"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired"),
    409: jsonErrorResponse("Cuso is paused or out of credits"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(
      c,
      await requestCmoArticleIdeas({ userId, projectId }).catch(rethrow),
    );
  });
}
