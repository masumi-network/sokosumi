import { createRoute, z } from "@hono/zod-openapi";
import type { EnterpriseContractStatus } from "@sokosumi/database";

import { mapEnterpriseContractForApi } from "@/helpers/enterprise-contract-api.js";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import {
  enterpriseContractSchema,
  listEnterpriseContractsQuerySchema,
} from "@/schemas/enterprise-contract.schema";

const route = createRoute({
  method: "get",
  path: "/",
  description: "List enterprise contracts (admin only)",
  tags: ["Enterprise Contracts"],
  request: {
    query: listEnterpriseContractsQuerySchema,
  },
  responses: {
    200: jsonSuccessResponse(
      z.array(enterpriseContractSchema),
      "List enterprise contracts",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const query = c.req.valid("query");

    let organizationId: string | undefined;
    if (query.organizationSlug) {
      const organization = await prisma.organization.findUnique({
        where: { slug: query.organizationSlug },
        select: { id: true },
      });

      if (!organization) {
        throw notFound("Organization not found");
      }

      organizationId = organization.id;
    }

    const items = await prisma.enterpriseContract.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(query.status
          ? { status: query.status as EnterpriseContractStatus }
          : {}),
      },
      include: {
        organization: {
          select: { slug: true },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    const mapped = items.map((item) => mapEnterpriseContractForApi(item));
    return ok(c, z.array(enterpriseContractSchema).parse(mapped));
  });
}
