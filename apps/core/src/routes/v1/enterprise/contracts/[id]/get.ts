import { createRoute } from "@hono/zod-openapi";

import { mapEnterpriseContractForApi } from "@/helpers/enterprise-contract-api.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  enterpriseContractIdParamsSchema,
  enterpriseContractSchema,
} from "@/schemas/enterprise-contract.schema";

const route = createRoute({
  method: "get",
  path: "/{id}",
  description: "Get enterprise contract detail with periods (admin only)",
  tags: ["Enterprise Contracts"],
  request: {
    params: enterpriseContractIdParamsSchema,
  },
  responses: {
    200: jsonSuccessResponse(
      enterpriseContractSchema,
      "Retrieve enterprise contract",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    const contract = await prisma.enterpriseContract.findUnique({
      where: { id },
      include: {
        periods: true,
      },
    });

    if (!contract) {
      throw notFound("Enterprise contract not found");
    }

    return ok(
      c,
      enterpriseContractSchema.parse(mapEnterpriseContractForApi(contract)),
    );
  });
}
