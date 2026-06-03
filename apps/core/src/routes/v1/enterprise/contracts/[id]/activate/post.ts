import { createRoute } from "@hono/zod-openapi";
import { activateEnterpriseContract } from "@sokosumi/database/helpers";

import { handleEnterpriseContractLifecycleError } from "@/helpers/enterprise-contract-route.js";
import { notFound } from "@/helpers/error";
import {
  jsonContent,
  jsonErrorResponse,
  jsonSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  activateEnterpriseContractRequestSchema,
  activateEnterpriseContractResponseSchema,
  enterpriseContractActivationConflictResponseSchema,
  enterpriseContractIdParamsSchema,
} from "@/schemas/enterprise-contract.schema";

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
    200: jsonSuccessResponse(
      activateEnterpriseContractResponseSchema,
      "Activate enterprise contract",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: {
      description:
        "Activation blocked by paid subscriptions (see blockers in response body)",
      content: jsonContent(enterpriseContractActivationConflictResponseSchema),
    },
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const exists = await prisma.enterpriseContract.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) {
      throw notFound("Enterprise contract not found");
    }

    const activatedAt = new Date();

    try {
      const result = await prisma.$transaction(async (tx) =>
        activateEnterpriseContract(
          id,
          {
            activatedAt,
            paymentReference: body.paymentReference,
          },
          tx,
        ),
      );

      return ok(c, activateEnterpriseContractResponseSchema.parse(result));
    } catch (error) {
      handleEnterpriseContractLifecycleError(error);
    }
  });
}
