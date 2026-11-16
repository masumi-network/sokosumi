import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import {
  cmoPieceTextSchema,
  cmoProjectParamsSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import { readCmoPieceText } from "@/services/cmo-strategy.service";

const route = createRoute({
  method: "get",
  path: "/projects/{projectId}/calendar/{id}/text",
  operationId: "getCmoCalendarEntryTextForProject",
  tags: ["CMO"],
  description:
    "The words of one approved calendar piece that lives in the Project's Files (an article, a page fix, ad copy, a newsletter issue).",
  request: {
    params: cmoProjectParamsSchema.extend(cmoUpdateIdParamsSchema.shape),
  },
  responses: {
    200: jsonSuccessResponse(cmoPieceTextSchema, "The piece's words"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not written yet, or Cuso is not hired"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId, id } = c.req.valid("param");
    const text = await readCmoPieceText({
      userId,
      projectId,
      entryId: id,
    }).catch(rethrow);
    return ok(c, { text });
  });
}
