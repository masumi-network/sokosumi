import { createRoute } from "@hono/zod-openapi";
import { EnterpriseContractStatus } from "@sokosumi/database";

import {
  assertEnterprisePeriodCount,
  creditsPerMonthToCents,
  mapEnterpriseContractForApi,
  optionalOneTimeCreditsToCents,
} from "@/helpers/enterprise-contract-api.js";
import { notFound, unprocessableEntity } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  createEnterpriseContractRequestSchema,
  enterpriseContractSchema,
} from "@/schemas/enterprise-contract.schema";

const route = createRoute({
  method: "post",
  path: "/",
  description: "Create a draft enterprise contract (admin only)",
  tags: ["Enterprise Contracts"],
  request: {
    body: {
      content: {
        "application/json": {
          schema: createEnterpriseContractRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      enterpriseContractSchema,
      "Create enterprise contract draft",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");

    assertEnterprisePeriodCount(body.periods);

    const organization = await prisma.organization.findUnique({
      where: { id: body.organizationId },
      select: { id: true },
    });

    if (!organization) {
      throw notFound("Organization not found");
    }

    const centsPerMonth = creditsPerMonthToCents(body.creditsPerMonth);
    const oneTimeCents = optionalOneTimeCreditsToCents(body.oneTimeCredits);

    if (oneTimeCents != null && oneTimeCents > 0n && !body.oneTimeExpiresAt) {
      throw unprocessableEntity(
        "oneTimeExpiresAt is required when oneTimeCredits is set",
      );
    }

    const record = await prisma.enterpriseContract.create({
      data: {
        organizationId: body.organizationId,
        status: EnterpriseContractStatus.draft,
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

    return created(
      c,
      enterpriseContractSchema.parse(mapEnterpriseContractForApi(record)),
    );
  });
}
