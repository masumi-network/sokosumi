import { createRoute, z } from "@hono/zod-openapi";
import { activateEnterpriseContract } from "@sokosumi/database/helpers";

import { handleEnterpriseContractLifecycleError } from "@/helpers/enterprise-contract-route.js";
import { errorResponseSchema } from "@/helpers/error";
import {
  jsonContent,
  jsonEnterpriseErrorResponse,
  jsonEnterpriseSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  activateEnterpriseContractRequestSchema,
  activateEnterpriseContractResponseSchema,
  enterpriseContractActivationConflictResponseSchema,
  enterpriseContractIdParamsSchema,
} from "@/schemas/enterprise-contract.schema";
import { SEAT_RECONCILIATION_CONFLICT_MESSAGE } from "@/services/organization-seat.service";

const route = createRoute({
  method: "post",
  path: "/{id}/activate",
  description: "Activate a draft enterprise contract (admin only)",
  tags: ["Enterprise Contracts"],
  request: {
    params: enterpriseContractIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: activateEnterpriseContractRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonEnterpriseSuccessResponse(
      activateEnterpriseContractResponseSchema,
      "Activate enterprise contract",
    ),
    401: jsonEnterpriseErrorResponse("Unauthorized"),
    403: jsonEnterpriseErrorResponse("Forbidden"),
    404: jsonEnterpriseErrorResponse("Not Found"),
    409: {
      description:
        "Conflict. Branch on `kind`: enterprise_activation_blocked (an active organization subscription blocks activation, see blocker in the response body), concurrency_conflict (serializable-transaction contention while assigning seats, retry the SAME request unchanged).",
      content: jsonContent(
        z.union([
          enterpriseContractActivationConflictResponseSchema,
          errorResponseSchema,
        ]),
      ),
    },
    422: jsonEnterpriseErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const activatedAt = new Date();

    try {
      // Serializable because activation auto-assigns seats (SOK-1007).
      // Postgres only aborts a serialization anomaly when both sides run at
      // this level, so this has to match the seat assignment routes.
      const result = await serializableTransaction(
        async (tx) =>
          activateEnterpriseContract(
            id,
            {
              activatedAt,
              paymentReference: body.paymentReference,
            },
            tx,
          ),
        SEAT_RECONCILIATION_CONFLICT_MESSAGE,
      );

      return ok(c, activateEnterpriseContractResponseSchema.parse(result));
    } catch (error) {
      handleEnterpriseContractLifecycleError(error);
    }
  });
}
