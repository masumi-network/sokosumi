import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireOverview, rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoDraftEditSchema,
  cmoDraftParamsSchema,
  cmoOverviewSchema,
} from "@/schemas/cmo.schema";
import { editCmoDraft } from "@/services/cmo-drafts.service";

const route = createRoute({
  method: "patch",
  path: "/projects/{projectId}/drafts/{postId}",
  operationId: "editCmoDraftForProject",
  tags: ["CMO"],
  description:
    "The owner rewrites the words of a Social post Cuso made. Its picture or video stays.",
  request: {
    params: cmoDraftParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: cmoDraftEditSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Draft changed"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet, or no such post"),
    409: jsonErrorResponse(
      "The post changed since it was shown, or it can no longer be changed",
    ),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, postId } = c.req.valid("param");
    const { revision, text } = c.req.valid("json");
    await editCmoDraft({ userId, projectId, postId, revision, text }).catch(
      rethrow,
    );
    return ok(c, await requireOverview({ userId, projectId }));
  });
}
