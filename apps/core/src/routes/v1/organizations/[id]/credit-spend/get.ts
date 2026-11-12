import { createRoute, z } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { convertCentsToCredits } from "@sokosumi/utils";

import { loadUserPreviewsByIds } from "@/helpers/history";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { resolveMemberOrganizationById } from "@/helpers/organization";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireOwnerUserContext } from "@/middleware/auth";
import { organizationCreditSpendSchema } from "@/schemas/organization-credit-spend.schema";

const params = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    description: "Organization ID",
    example: "org_123",
  }),
});

const route = createRoute({
  method: "get",
  path: "/{id}/credit-spend",
  description:
    "Credits the organization spent this UTC month and last, per billed user (owner/admin only). Spend is every negative ledger row before refunds, as in History. Charges billed to no person get their own row.",
  tags: ["Organizations"],
  request: { params },
  responses: {
    200: jsonSuccessResponse(
      organizationCreditSpendSchema,
      "Credit spend per billed user",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden - You are not an owner or admin of this organization",
    ),
    404: jsonErrorResponse("Not Found - Organization not found"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

function toMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const userContext = requireOwnerUserContext(c.var.authContext);
    const { id } = c.req.valid("param");

    const { organization } = await resolveMemberOrganizationById({
      id,
      userId: userContext.userId,
      tx: prisma,
      allowedRoles: [MemberRole.OWNER, MemberRole.ADMIN],
    });

    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const previousMonthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );
    const spendWhere = (from: Date, to?: Date) => ({
      organizationId: organization.id,
      amount: { lt: 0n },
      createdAt: { gte: from, ...(to ? { lt: to } : {}) },
    });

    // ponytail: scans the organization's ledger like History's workspace
    // scope; add an (organizationId, createdAt) index if this gets slow.
    const [current, previous, members] = await Promise.all([
      prisma.transaction.groupBy({
        by: ["userId"],
        where: spendWhere(monthStart),
        _sum: { amount: true },
      }),
      prisma.transaction.groupBy({
        by: ["userId"],
        where: spendWhere(previousMonthStart, monthStart),
        _sum: { amount: true },
      }),
      prisma.member.findMany({
        where: { organizationId: organization.id },
        select: { userId: true },
      }),
    ]);

    const memberIds = new Set(members.map((member) => member.userId));
    const spent = (rows: typeof current) =>
      new Map(
        rows.map((row) => [
          row.userId,
          convertCentsToCredits(-(row._sum.amount ?? 0n)),
        ]),
      );
    const currentByUser = spent(current);
    const previousByUser = spent(previous);
    const userIds = new Set<string | null>([
      ...memberIds,
      ...currentByUser.keys(),
      ...previousByUser.keys(),
    ]);
    const previews = await loadUserPreviewsByIds(
      [...userIds].filter((userId): userId is string => userId !== null),
      prisma,
    );

    const rows = [...userIds]
      .map((userId) => {
        const preview = userId ? previews.get(userId) : undefined;
        return {
          userId,
          name: preview?.name ?? null,
          image: preview?.image ?? null,
          isMember: userId !== null && memberIds.has(userId),
          credits: currentByUser.get(userId) ?? 0,
          previousCredits: previousByUser.get(userId) ?? 0,
        };
      })
      .sort(
        (a, b) =>
          b.credits - a.credits ||
          b.previousCredits - a.previousCredits ||
          (a.name ?? "").localeCompare(b.name ?? ""),
      );

    return ok(
      c,
      organizationCreditSpendSchema.parse({
        month: toMonth(monthStart),
        previousMonth: toMonth(previousMonthStart),
        rows,
      }),
    );
  });
}
