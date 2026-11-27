import { createRoute } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { preprodControlOf } from "@/helpers/preprod-control";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { adminPreprodPauseSchema } from "@/schemas/admin.schema";

const route = createRoute({
  method: "get",
  path: "/preprod/pause",
  operationId: "getAdminPreprodPause",
  description:
    "Whether Preprod is paused, its generation number, and the 20 most recent pause changes (admin only). A value that cannot be read or is not valid answers 500.",
  tags: ["Admin"],
  responses: {
    200: jsonSuccessResponse(
      adminPreprodPauseSchema,
      "The Preprod pause, its generation and its recent changes",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    return ok(c, adminPreprodPauseSchema.parse(await preprodControlOf(prisma)));
  });
}
