import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { cmoSeoSchema } from "@/schemas/cmo-seo.schema";
import { readCmoSeo } from "@/services/cmo-seo.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/seo",
  operationId: "getCmoSeoForProject",
  tags: ["CMO"],
  description:
    "The SEO tab: the weekly site audit, Search Console, article suggestions, page changes and recent keyword searches.",
  request: { params: cmoProjectParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoSeoSchema, "The SEO tab"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    return ok(c, await readCmoSeo({ userId, projectId }).catch(rethrow));
  });
}
