import { createRoute, z } from "@hono/zod-openapi";

import { requireTaskReadForRouteVars } from "@/helpers/access-control";
import { resolveTaskSellerReceipt } from "@/helpers/coworker-task-receipt";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

const paramsSchema = z.object({
  id: z.string().openapi({
    param: { name: "id", in: "path" },
    example: "tsk_123",
  }),
});

const taskSellerReceiptSchema = z
  .object({
    blockchainIdentifier: z.string().nullable(),
    claimStatus: z.string().nullable(),
    onChainState: z.string().nullable(),
    settled: z.boolean(),
    txHash: z.string().nullable(),
    withdrawnForSeller: z.array(
      z.object({
        unit: z.string().nullable(),
        amount: z.string().nullable(),
      }),
    ),
  })
  .openapi("TaskSellerReceipt");

const route = createRoute({
  method: "get",
  path: "/{id}/receipt",
  description:
    "Prove the intended seller receipt for a Coworker Task payment. Resolves the task's payment claim through the Masumi Payment Service; settled is true only when the escrow paid the seller on-chain (onChainState Withdrawn).",
  tags: ["Tasks"],
  request: {
    params: paramsSchema,
  },
  responses: {
    200: jsonSuccessResponse(taskSellerReceiptSchema, "Task seller receipt"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { id } = c.req.valid("param");

    await requireTaskReadForRouteVars(c.var, id, prisma);

    const receipt = await resolveTaskSellerReceipt(id, prisma);

    return ok(c, taskSellerReceiptSchema.parse(receipt));
  });
}
