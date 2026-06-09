import { createRoute } from "@hono/zod-openapi";
import { EnterpriseContractStatus } from "@sokosumi/database";

import {
  assertEnterprisePeriodCount,
  creditsPerMonthToCents,
  enterpriseContractOrganizationSelect,
  mapEnterpriseContractForApi,
  optionalOneTimeCreditsToCents,
} from "@/helpers/enterprise-contract-api.js";
import { conflict, notFound } from "@/helpers/error";
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
  patchEnterpriseContractRequestSchema,
} from "@/schemas/enterprise-contract.schema";

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description: "Update a draft enterprise contract (admin only)",
  tags: ["Enterprise Contracts"],
  request: {
    params: enterpriseContractIdParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: patchEnterpriseContractRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonEnterpriseSuccessResponse(
      enterpriseContractSchema,
      "Update enterprise contract draft",
    ),
    401: jsonEnterpriseErrorResponse("Unauthorized"),
    403: jsonEnterpriseErrorResponse("Forbidden"),
    404: jsonEnterpriseErrorResponse("Not Found"),
    409: jsonEnterpriseErrorResponse("Conflict"),
    422: jsonEnterpriseErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const body = c.req.valid("json");

    const current = await prisma.enterpriseContract.findUnique({
      where: { id },
    });

    if (!current) {
      throw notFound("Enterprise contract not found");
    }

    if (current.status !== EnterpriseContractStatus.draft) {
      throw conflict("Only draft enterprise contracts can be updated");
    }

    if (body.periods !== undefined) {
      assertEnterprisePeriodCount(body.periods);
    }

    const centsPerMonth =
      body.creditsPerMonth !== undefined
        ? creditsPerMonthToCents(body.creditsPerMonth)
        : undefined;

    const oneTimeCents =
      body.oneTimeCredits !== undefined
        ? body.oneTimeCredits === null
          ? null
          : optionalOneTimeCreditsToCents(body.oneTimeCredits)
        : undefined;

    const updated = await prisma.enterpriseContract.update({
      where: { id },
      data: {
        periodCount: body.periods,
        seats: body.seats,
        centsPerMonth,
        oneTimeCents,
        oneTimeExpiresAt: body.oneTimeExpiresAt,
        paymentReference: body.paymentReference,
        notes: body.notes,
        externalReference: body.externalReference,
      },
      include: enterpriseContractOrganizationSelect,
    });

    return ok(
      c,
      enterpriseContractSchema.parse(mapEnterpriseContractForApi(updated)),
    );
  });
}
