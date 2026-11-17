import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import {
  seoTaskRelatedPagesReceiptSchema,
  seoTaskRelatedPagesRequestSchema,
} from "@/schemas/seo-task-pages.schema";
import { freezeSeoTaskRelatedIndexing } from "@/services/seo-task-pages.service";

const route = createRoute({
  method: "post",
  path: "/{id}/seo-indexing/related-pages/context-v1",
  tags: ["Tasks"],
  description:
    "Freeze at most ten exact-host indexing inspection targets for the assigned audit Task. Related URLs remain evidence; saved pages and the full-audit scope do not change.",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    body: {
      required: true,
      content: {
        "application/json": { schema: seoTaskRelatedPagesRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      seoTaskRelatedPagesReceiptSchema,
      "Immutable indexing evidence selection",
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
      await freezeSeoTaskRelatedIndexing(
        auth,
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
    );
  });
}
