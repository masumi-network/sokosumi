import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { cmoOverviewSchema } from "@/schemas/cmo.schema";
import { finalizeCmoChannel } from "@/services/cmo.service";

import { requireOverview, rethrow } from "../../helpers";

const route = createRoute({
  method: "post",
  path: "/channels/finalize",
  operationId: "finalizeCmoChannel",
  tags: ["CMO"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({ connectionId: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Account connected"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Unknown or expired connection"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { connectionId } = c.req.valid("json");
    await finalizeCmoChannel({ userId, connectionId }).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
