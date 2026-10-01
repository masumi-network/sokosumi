import { createRoute, type z } from "@hono/zod-openapi";
import {
  EnterpriseContractPeriodStatus,
  EnterpriseContractStatus,
} from "@sokosumi/database";

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
import { serializableTransaction } from "@/lib/db/transaction";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  enterpriseContractIdParamsSchema,
  enterpriseContractSchema,
  patchEnterpriseContractRequestSchema,
} from "@/schemas/enterprise-contract.schema";

const route = createRoute({
  method: "patch",
  path: "/{id}",
  description:
    "Update a draft enterprise contract, or change creditsPerMonth on an active one for every period not yet granted (admin only)",
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
      "Update enterprise contract",
    ),
    401: jsonEnterpriseErrorResponse("Unauthorized"),
    403: jsonEnterpriseErrorResponse("Forbidden"),
    404: jsonEnterpriseErrorResponse("Not Found"),
    409: jsonEnterpriseErrorResponse("Conflict"),
    422: jsonEnterpriseErrorResponse("Unprocessable Entity"),
  },
});

// Each period copies centsToGrant at activation, and the scheduler grants that
// copy. Only periods still scheduled take the new amount; granted months keep
// the credits they already received.
async function updateActiveContractCreditsPerMonth(
  id: string,
  body: z.infer<typeof patchEnterpriseContractRequestSchema>,
  fieldNames: string[],
) {
  const { creditsPerMonth } = body;
  const hasOtherFields = fieldNames.some(
    (field) => field !== "creditsPerMonth",
  );
  if (creditsPerMonth === undefined || hasOtherFields) {
    throw conflict(
      "Only creditsPerMonth can be changed on an active enterprise contract",
    );
  }

  const centsPerMonth = creditsPerMonthToCents(creditsPerMonth);

  return await serializableTransaction(async (tx) => {
    const current = await tx.enterpriseContract.findUnique({ where: { id } });
    if (!current) {
      throw notFound("Enterprise contract not found");
    }
    if (current.status !== EnterpriseContractStatus.active) {
      throw conflict(
        "Only active enterprise contracts can change future monthly credits",
      );
    }

    // Periods before the contract: cancellation and the scheduler lock in
    // that order, so a concurrent cancel cannot deadlock against this write.
    await tx.enterpriseContractPeriod.updateMany({
      where: {
        contractId: id,
        status: EnterpriseContractPeriodStatus.scheduled,
      },
      data: { centsToGrant: centsPerMonth },
    });

    return await tx.enterpriseContract.update({
      where: { id },
      data: { centsPerMonth },
      include: enterpriseContractOrganizationSelect,
    });
  }, "Enterprise contract changed concurrently; retry the credit update");
}

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

    if (current.status === EnterpriseContractStatus.active) {
      // Zod strips unknown fields. Check the cached request as well so an
      // active mutation cannot silently accept anything except monthly credits.
      const fieldNames = Object.keys(
        await c.req.json<Record<string, unknown>>(),
      );
      return ok(
        c,
        enterpriseContractSchema.parse(
          mapEnterpriseContractForApi(
            await updateActiveContractCreditsPerMonth(id, body, fieldNames),
          ),
        ),
      );
    }

    if (current.status !== EnterpriseContractStatus.draft) {
      throw conflict(
        "Only draft or active enterprise contracts can be updated",
      );
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
