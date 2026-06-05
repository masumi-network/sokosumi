import { createRoute } from "@hono/zod-openapi";
import { cancelEnterpriseContract } from "@sokosumi/database/helpers";

import { mapEnterpriseContractForApi } from "@/helpers/enterprise-contract-api.js";
import { handleEnterpriseContractLifecycleError } from "@/helpers/enterprise-contract-route.js";
import { notFound } from "@/helpers/error";
import {
  jsonEnterpriseErrorResponse,
  jsonEnterpriseSuccessResponse,
} from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  enterpriseContractIdParamsSchema,
  enterpriseContractSchema,
} from "@/schemas/enterprise-contract.schema";

const route = createRoute({
  method: "post",
  path: "/{id}/cancel",
  description: "Cancel an active enterprise contract (admin only)",
  tags: ["Enterprise Contracts"],
  request: {
    params: enterpriseContractIdParamsSchema,
  },
  responses: {
    200: jsonEnterpriseSuccessResponse(
      enterpriseContractSchema,
      "Cancel enterprise contract",
    ),
    401: jsonEnterpriseErrorResponse("Unauthorized"),
    403: jsonEnterpriseErrorResponse("Forbidden"),
    404: jsonEnterpriseErrorResponse("Not Found"),
    409: jsonEnterpriseErrorResponse("Conflict"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const now = new Date();

    try {
      await prisma.$transaction(async (tx) =>
        cancelEnterpriseContract(id, tx, now),
      );
    } catch (error) {
      handleEnterpriseContractLifecycleError(error);
    }

    const canceled = await prisma.enterpriseContract.findUnique({
      where: { id },
      include: {
        organization: {
          select: { slug: true },
        },
      },
    });

    if (!canceled) {
      throw notFound("Enterprise contract not found");
    }

    return ok(
      c,
      enterpriseContractSchema.parse(mapEnterpriseContractForApi(canceled)),
    );
  });
}
