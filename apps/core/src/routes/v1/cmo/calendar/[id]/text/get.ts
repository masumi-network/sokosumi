import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoPieceTextSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import { readCmoPieceText } from "@/services/cmo-strategy.service";

import { rethrow } from "../../../helpers";

const route = createRoute({
  method: "get",
  path: "/calendar/{id}/text",
  operationId: "getCmoCalendarEntryText",
  tags: ["CMO"],
  description:
    "The words of one approved calendar piece that lives in the Project's Files (an article, a page fix, ad copy, a newsletter issue).",
  request: {
    params: cmoUpdateIdParamsSchema,
    query: z.object({ strategyId: z.uuid().optional() }),
  },
  responses: {
    200: jsonSuccessResponse(cmoPieceTextSchema, "The piece's words"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not written yet, or Cuso is not hired"),
    409: jsonErrorResponse("The approved calendar changed"),
    422: jsonErrorResponse("Invalid strategy id"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const { strategyId } = c.req.valid("query");
    const text = await readCmoPieceText({
      userId,
      entryId: id,
      strategyId,
    }).catch(rethrow);
    return ok(c, { text });
  });
}
