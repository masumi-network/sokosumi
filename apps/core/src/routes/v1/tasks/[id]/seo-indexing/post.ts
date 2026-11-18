import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";
import {
  seoTaskIndexingReceiptSchema,
  seoTaskIndexingRequestSchema,
  seoTaskIndexingResultAcknowledgmentSchema,
  seoTaskIndexingResultRequestSchema,
} from "@/schemas/seo-task-indexing.schema";
import {
  readSeoTaskIndexing,
  recordSeoTaskIndexingResult,
} from "@/services/seo-task-indexing.service";

const params = z.object({ id: z.string().min(1).max(128) });
const RETRYABLE_HEADER = "X-SEO-Indexing-Retryable";
const errors = {
  400: jsonErrorResponse("Bad Request"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Not Found"),
  409: jsonErrorResponse("Conflict"),
  422: jsonErrorResponse("Unprocessable Entity"),
};

const readRoute = createRoute({
  method: "post",
  path: "/{id}/seo-indexing/context-v1",
  tags: ["Tasks"],
  description:
    "Read a private, finite URL Inspection receipt for the assigned full-audit Task's approved pages. No caller-selected Google account, property, URL or provider operation is accepted.",
  request: {
    params,
    body: {
      required: true,
      content: { "application/json": { schema: seoTaskIndexingRequestSchema } },
    },
  },
  responses: {
    200: {
      ...jsonSuccessResponse(
        seoTaskIndexingReceiptSchema,
        "Private URL Inspection receipt",
      ),
      headers: {
        [RETRYABLE_HEADER]: {
          description:
            "Whether a provider read failed and the worker should retry this receipt.",
          schema: { type: "boolean" },
        },
      },
    },
    ...errors,
    503: jsonErrorResponse("Google access could not be verified"),
  },
});

const resultRoute = createRoute({
  method: "post",
  path: "/{id}/seo-indexing/result/context-v1",
  tags: ["Tasks"],
  description:
    "Save the SEO worker's private indexing assessment for one current Task receipt. Google evidence never enters a public report file or Task comment.",
  request: {
    params,
    body: {
      required: true,
      content: {
        "application/json": { schema: seoTaskIndexingResultRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      seoTaskIndexingResultAcknowledgmentSchema,
      "Private indexing assessment saved",
    ),
    ...errors,
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(readRoute, async (c) => {
    const auth = requireCoworkerAuthContext(c.var.authContext);
    c.header("Cache-Control", "no-store");
    const result = await readSeoTaskIndexing(
      auth,
      c.req.valid("param").id,
      c.req.valid("json").expectedContext,
      c.req.valid("json").auditPageUrl,
    );
    c.header(RETRYABLE_HEADER, String(result.retryable));
    return ok(c, result.receipt);
  });
  app.openapi(resultRoute, async (c) => {
    const auth = requireCoworkerAuthContext(c.var.authContext);
    c.header("Cache-Control", "no-store");
    const result = await recordSeoTaskIndexingResult(
      auth,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return ok(
      c,
      seoTaskIndexingResultAcknowledgmentSchema.parse({
        version: result.version,
        taskId: result.taskId,
        receiptHash: result.receiptHash,
      }),
    );
  });
}
