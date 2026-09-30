import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  mpsSellerSchema,
  revokeMpsSellerSchema,
} from "@/schemas/mps-seller.schema";
import { revokeMpsSeller } from "@/services/mps-seller.service";
import { paramsSchema } from "../../schema";

const route = createRoute({
  method: "post",
  path: "/{id}/mps-seller/revoke",
  operationId: "revokeMpsSeller",
  tags: ["Coworkers"],
  description:
    "Manage a verified MPS seller. Requires Vendor admin membership. Payments remain disabled.",
  request: {
    params: paramsSchema,
    body: {
      content: { "application/json": { schema: revokeMpsSellerSchema } },
    },
  },
  responses: {
    200: jsonSuccessResponse(mpsSellerSchema, "MPS seller configuration"),
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
    const { id } = c.req.valid("param");
    return ok(
      c,
      await revokeMpsSeller(
        c.var.authContext,
        id,
        c.req.valid("json").bindingId,
      ),
    );
  });
}
