import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import {
  listSokoBotLabRunsQuerySchema,
  sokoBotLabRunSchema,
} from "@/schemas/soko-bot.schema";

const listLabRunsRoute = createRoute({
  method: "get",
  path: "/me/lab/runs",
  operationId: "listMySokoBotLabRuns",
  tags: ["Soko Bots"],
  request: { query: listSokoBotLabRunsQuerySchema },
  responses: {
    200: jsonSuccessResponse(z.array(sokoBotLabRunSchema), "Recorded lab runs"),
    401: jsonErrorResponse("Unauthorized"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(listLabRunsRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const { versionId, limit } = c.req.valid("query");
    const runs = await prisma.sokoBotLabRun.findMany({
      where: { userId: auth.userId, ...(versionId ? { versionId } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        turn: {
          select: { durationMs: true, costUsdMicros: true },
        },
      },
    });
    return ok(
      c,
      z.array(sokoBotLabRunSchema).parse(
        runs.map(({ turn, ...run }) => ({
          ...run,
          judge: run.judge ?? null,
          durationMs: turn.durationMs,
          costUsd:
            turn.costUsdMicros === null
              ? null
              : Number(turn.costUsdMicros) / 1e6,
        })),
      ),
    );
  });
}
