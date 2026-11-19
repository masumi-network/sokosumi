import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireOverview, rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoDraftParamsSchema,
  cmoDraftRevisionSchema,
  cmoOverviewSchema,
} from "@/schemas/cmo.schema";
import { declineCmoDraft } from "@/services/cmo-drafts.service";

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/drafts/{postId}/decline",
  operationId: "declineCmoDraftForProject",
  tags: ["CMO"],
  description:
    "The owner turns down a Social post Cuso made, or stops an approved one before it goes out: it is canceled and never published.",
  request: {
    params: cmoDraftParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: cmoDraftRevisionSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Draft declined"),
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
    const { revision } = c.req.valid("json");
    await declineCmoDraft({ userId, projectId, postId, revision }).catch(
      rethrow,
    );
    return ok(c, await requireOverview({ userId, projectId }));
  });
}
