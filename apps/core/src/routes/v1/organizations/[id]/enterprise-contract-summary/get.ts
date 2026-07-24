import { createRoute, z } from "@hono/zod-openapi";
import { resolveOrganizationBillingPlan } from "@sokosumi/database/helpers";

import { getEnterpriseContractBillingSummary } from "@/helpers/enterprise-contract-summary.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserContext } from "@/middleware/auth";
import { enterpriseContractBillingSummarySchema } from "@/schemas/enterprise-contract-summary.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/enterprise-contract-summary",
  operationId: "getOrganizationEnterpriseContractSummary",
  description:
    "Get the enterprise contract billing summary for an organization the caller is a member of. Returns 404 when the organization is not on an active enterprise contract.",
  tags: ["Organizations"],
  request: {
    params,
  },
  responses: {
    200: jsonSuccessResponse(
      enterpriseContractBillingSummarySchema,
      "Enterprise contract billing summary",
      {
        data: {
          activatedAt: "2026-01-15T00:00:00.000Z",
          endsAt: "2026-12-14T23:59:59.999Z",
          currentPeriodEnd: "2026-03-14T23:59:59.999Z",
          isConsumable: true,
          monthlyCredits: 6000,
          nextActivationAt: "2026-03-15T00:00:00.000Z",
          poolRemainingCredits: 2500,
          purchasedSeats: 10,
        },
        meta: {
          timestamp: "2025-01-01T00:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You are not a member of this organization",
    ),
    404: jsonErrorResponse(
      "Not Found - Organization not found or not on an enterprise contract",
    ),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireUserContext(c.var.authContext);
    const { id } = c.req.valid("param");
    const now = new Date();

    const summary = await prisma.$transaction(async (tx) => {
      await resolveMemberOrganizationById({
        id,
        userId: userContext.userId,
        tx,
      });

      const billingPlan = await resolveOrganizationBillingPlan(id, tx, now);
      if (billingPlan.mode !== "enterprise_contract") {
        return null;
      }

      return getEnterpriseContractBillingSummary(billingPlan, id, tx, now);
    });

    if (!summary) {
      throw notFound("Organization is not on an enterprise contract");
    }

    return ok(c, enterpriseContractBillingSummarySchema.parse(summary));
  });
}
