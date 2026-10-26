import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoOverviewSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import { pauseCmoCalendarEntry } from "@/services/cmo.service";

import { requireOverview, rethrow } from "../../../helpers";

const route = createRoute({
  method: "post",
  path: "/calendar/{id}/pause",
  operationId: "pauseCmoCalendarEntry",
  tags: ["CMO"],
  description:
    "Pauses one calendar entry: cancels its scheduled post and takes it out of the plan.",
  request: { params: cmoUpdateIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoOverviewSchema, "Entry paused"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("No such calendar entry"),
    409: jsonErrorResponse("The post can no longer be canceled"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    await pauseCmoCalendarEntry({ userId, entryId: id }).catch(rethrow);
    return ok(c, await requireOverview(userId));
  });
}
