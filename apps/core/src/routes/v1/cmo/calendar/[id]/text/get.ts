import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  cmoPieceTextSchema,
  cmoUpdateIdParamsSchema,
} from "@/schemas/cmo.schema";
import type { CusoTarget } from "@/services/cmo-cuso.service";
import { readCmoPieceText } from "@/services/cmo-strategy.service";

import { rethrow } from "../../../helpers";

export const config = {
  method: "get" as const,
  tags: ["CMO"],
  description:
    "The words of one approved calendar piece that lives in the Project's Files (an article, a page fix, ad copy, a newsletter issue).",
  request: { params: cmoUpdateIdParamsSchema },
  responses: {
    200: jsonSuccessResponse(cmoPieceTextSchema, "The piece's words"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not written yet, or Cuso is not hired"),
  },
};

const route = createRoute({
  ...config,
  path: "/calendar/{id}/text",
  operationId: "getCmoCalendarEntryText",
});

export async function readText(target: CusoTarget, entryId: string) {
  const text = await readCmoPieceText({ ...target, entryId }).catch(rethrow);
  return { text };
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { id } = c.req.valid("param");
    return ok(c, await readText({ userId }, id));
  });
}
