import { createRoute } from "@hono/zod-openapi";
import { EnterpriseContractStatus } from "@sokosumi/database";

import {
  assertEnterprisePeriodCount,
  creditsPerMonthToCents,
  mapEnterpriseContractForApi,
  optionalOneTimeCreditsToCents,
} from "@/helpers/enterprise-contract-api.js";
import { conflict, notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
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
    200: jsonSuccessResponse(
      enterpriseContractSchema,
      "Update enterprise contract draft",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
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

    const resolvedOneTimeCents =
      oneTimeCents !== undefined ? oneTimeCents : current.oneTimeCents;
    const resolvedOneTimeExpiresAt =
      body.oneTimeExpiresAt !== undefined
        ? body.oneTimeExpiresAt
        : current.oneTimeExpiresAt;

    if (
      resolvedOneTimeCents != null &&
      resolvedOneTimeCents > 0n &&
      !resolvedOneTimeExpiresAt
    ) {
      throw unprocessableEntity(
        "oneTimeExpiresAt is required when oneTimeCredits is set",
      );
    }

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
    });

    return ok(
      c,
      enterpriseContractSchema.parse(mapEnterpriseContractForApi(updated)),
    );
  });
}
