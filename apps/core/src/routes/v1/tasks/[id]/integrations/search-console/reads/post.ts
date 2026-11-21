import { createRoute, z } from "@hono/zod-openapi";
import { bodyLimit } from "hono/body-limit";

import { payloadTooLarge } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  seoTaskSearchConsoleReadSchema,
  seoTaskSearchConsoleReplySchema,
} from "@/schemas/seo-task-search-console.schema";
import { readSeoTaskSearchConsole } from "@/services/seo-task-search-console.service";

const MAX_BODY_BYTES = 64 * 1024;

const route = createRoute({
  method: "post",
  path: "/{id}/integrations/search-console/reads",
  tags: ["Tasks"],
  description:
    "Run one read-only Search Console operation for the configured SEO worker on the audit's approved property. Core keeps the Google account and every credential. The site list holds only the approved property.",
  request: {
    params: z.object({ id: z.string().min(1).max(128) }),
    body: {
      required: true,
      content: {
        "application/json": { schema: seoTaskSearchConsoleReadSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      seoTaskSearchConsoleReplySchema,
      "Google's HTTP status and native JSON body",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse(
      "Conflict. Branch on `kind`: task_context_changed, seo_gsc_not_connected, seo_gsc_reconnect, seo_gsc_property or seo_gsc_unavailable.",
    ),
    413: jsonErrorResponse("Payload Too Large"),
    422: jsonErrorResponse("Unprocessable Entity"),
    429: jsonErrorResponse("The Task used its read budget for this operation"),
    502: jsonErrorResponse(
      "Bad Gateway. `kind` seo_gsc_response_too_large means Google answered with more than Core forwards.",
    ),
    503: jsonErrorResponse("Search Console could not be read. Retry."),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.use(
    "/:id/integrations/search-console/reads",
    bodyLimit({
      maxSize: MAX_BODY_BYTES,
      onError: () => {
        throw payloadTooLarge(
          `Request body is too large. Maximum size is ${MAX_BODY_BYTES} bytes.`,
        );
      },
    }),
  );
  app.openapi(route, async (c) => {
    c.header("Cache-Control", "no-store");
    return ok(
      c,
      await readSeoTaskSearchConsole(
        c.var.authContext,
        c.req.valid("param").id,
        c.req.valid("json"),
      ),
    );
  });
}
