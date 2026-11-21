import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoPicturesQuerySchema,
  cmoPicturesSchema,
  cmoProjectParamsSchema,
} from "@/schemas/cmo.schema";
import { listCmoPictures } from "@/services/cmo-pictures.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/pictures",
  operationId: "getCmoPicturesForProject",
  tags: ["CMO"],
  description:
    "Every picture Cuso made for the month's posts, grouped by post and newest first: the one that went on the post, the alternatives that did not with the check's verdict, the tries that failed, and why the chosen one won. CMO's Settings, Pictures page.",
  request: { params: cmoProjectParamsSchema, query: cmoPicturesQuerySchema },
  responses: {
    200: jsonSuccessResponse(cmoPicturesSchema, "Cuso's pictures"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { network, month, chosen } = c.req.valid("query");
    const groups = await listCmoPictures({
      userId,
      projectId,
      network,
      month,
      chosenOnly: chosen === "true",
    }).catch(rethrow);
    return ok(c, { groups });
  });
}
