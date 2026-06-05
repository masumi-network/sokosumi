import { createRoute } from "@hono/zod-openapi";
import { EnterpriseContractStatus } from "@sokosumi/database";
import { previewEnterpriseContractPeriods } from "@sokosumi/database/helpers";
import {
  derivePreviewContractEnd,
  mapEnterpriseContractPreviewPeriodForApi,
  parseEnterpriseContractActivatedAt,
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
    200: jsonEnterpriseSuccessResponse(
      enterpriseContractPreviewSchema,
      "Preview enterprise contract periods",
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
    const { activatedAt: activatedAtRaw } = c.req.valid("query");
    const activatedAt = parseEnterpriseContractActivatedAt(activatedAtRaw);

    const contract = await prisma.enterpriseContract.findUnique({
      where: { id },
    });

    if (!contract) {
      throw notFound("Enterprise contract not found");
    }

    if (contract.status !== EnterpriseContractStatus.draft) {
      throw conflict("Only draft enterprise contracts can be previewed");
    }

    const schedule = previewEnterpriseContractPeriods({
      activatedAt,
      centsPerMonth: contract.centsPerMonth,
      periodCount: contract.periodCount,
      purchasedSeats: contract.seats,
    });

    const endsAt = derivePreviewContractEnd({
      activatedAt,
      periodCount: contract.periodCount,
    });

    return ok(
      c,
      enterpriseContractPreviewSchema.parse({
        activatedAt,
        endsAt,
        periods: schedule.map(mapEnterpriseContractPreviewPeriodForApi),
      }),
    );
  });
}
