import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import {
  seoTaskPagesReceiptSchema,
  seoTaskPagesRequestSchema,
} from "@/schemas/seo-task-pages.schema";
import { selectSeoTaskPages } from "@/services/seo-task-pages.service";

const route = createRoute({
  method: "post",
  path: "/{id}/seo-pages/context-v1",
  tags: ["Tasks"],
  description:
    "Seal at most ten public pages on the approved full audit's exact host. Only its assigned worker can select related pages; retries retain the first committed selection.",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    body: {
      required: true,
      content: { "application/json": { schema: seoTaskPagesRequestSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      seoTaskPagesReceiptSchema,
      "Immutable audit page selection",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const auth = requireCoworkerAuthContext(c.var.authContext);
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await selectSeoTaskPages(
        auth,
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
    );
  });
}
