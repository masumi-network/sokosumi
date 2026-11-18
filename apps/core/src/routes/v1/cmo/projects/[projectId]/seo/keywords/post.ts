import { createRoute } from "@hono/zod-openapi";
import { serviceUnavailable } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import {
  cmoKeywordSearchRequestSchema,
  cmoKeywordSearchSchema,
} from "@/schemas/cmo-seo.schema";
import { CmoError, requireCuso } from "@/services/cmo-cuso.service";
import { searchCmoKeywords } from "@/services/cmo-seo.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/seo/keywords",
  operationId: "searchCmoKeywordsForProject",
  tags: ["CMO"],
  description:
    "Keyword ideas for a topic in the brand's market: monthly searches, difficulty, intent and the site's position. The same topic is read again after a week.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      content: {
        "application/json": { schema: cmoKeywordSearchRequestSchema },
      },
      required: true,
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoKeywordSearchSchema, "The keyword ideas"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired"),
    409: jsonErrorResponse("No keyword searches left today"),
    503: jsonErrorResponse("Keyword research is unavailable"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { topic } = c.req.valid("json");
    const cuso = await requireCuso({ userId, projectId }).catch(rethrow);
    const search = await searchCmoKeywords(cuso, topic).catch((error) => {
      if (error instanceof CmoError) rethrow(error);
      throw serviceUnavailable(
        "Keyword research is unavailable right now. Try again later.",
      );
    });
    return ok(c, search);
  });
}
