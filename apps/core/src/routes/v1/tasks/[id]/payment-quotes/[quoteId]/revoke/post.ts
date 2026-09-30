import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { taskMpsPaymentQuoteSchema } from "@/schemas/task-mps-payment-quote.schema";
import { revokeTaskMpsPaymentQuote } from "@/services/task-mps-payment-quote.service";

const route = createRoute({
  method: "post",
  path: "/{id}/payment-quotes/{quoteId}/revoke",
  operationId: "revokeTaskMpsPaymentQuote",
  tags: ["Tasks"],
  description:
    "Manage fixed MPS quotes as the Task billing owner. Approval does not debit credits or enable paid execution.",
  request: {
    params: z.object({ id: z.string().min(1), quoteId: z.string().min(1) }),
  },
  responses: {
    200: jsonSuccessResponse(
      taskMpsPaymentQuoteSchema,
      "Task MPS payment quote",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id, quoteId } = c.req.valid("param");
    return ok(
      c,
      await revokeTaskMpsPaymentQuote(c.var.authContext, id, quoteId),
    );
  });
}
