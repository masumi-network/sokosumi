import { createRoute } from "@hono/zod-openapi";
import {
  previewEnterpriseContractPeriods,
  resolveContractStartDate,
} from "@sokosumi/database/helpers";
import {
  derivePreviewContractEnd,
  mapEnterpriseContractPreviewPeriodForApi,
} from "@/helpers/enterprise-contract-api.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  enterpriseContractIdParamsSchema,
  enterpriseContractPreviewQuerySchema,
  enterpriseContractPreviewSchema,
} from "@/schemas/enterprise-contract.schema";

const route = createRoute({
  method: "get",
  path: "/{id}/periods/preview",
  description:
    "Preview the period schedule for a draft contract without persisting (admin only)",
  tags: ["Enterprise Contracts"],
  request: {
    params: enterpriseContractIdParamsSchema,
    query: enterpriseContractPreviewQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      enterpriseContractPreviewSchema,
      "Preview enterprise contract periods",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");
    const { activatedAt: activatedAtRaw } = c.req.valid("query");
    const activatedAt = new Date(activatedAtRaw);

    const contract = await prisma.enterpriseContract.findUnique({
      where: { id },
    });

    if (!contract) {
      throw notFound("Enterprise contract not found");
    }

    const schedule = previewEnterpriseContractPeriods({
      activatedAt,
      centsPerMonth: contract.centsPerMonth,
      periodCount: contract.periodCount,
      purchasedSeats: contract.seats,
      startDate: contract.startDate,
    });

    const startDate = resolveContractStartDate(contract.startDate, activatedAt);
    const contractEnd = derivePreviewContractEnd({
      activatedAt,
      periodCount: contract.periodCount,
      startDate: contract.startDate,
    });

    return ok(
      c,
      enterpriseContractPreviewSchema.parse({
        activatedAt,
        startDate,
        contractEnd,
        periods: schedule.map(mapEnterpriseContractPreviewPeriodForApi),
      }),
    );
  });
}
