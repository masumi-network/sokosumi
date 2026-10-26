import { createRoute, type z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import prisma from "@/lib/db/prisma";
import type { EnvVariables, OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { resolveSokoBotDecisionRequestSchema } from "@/schemas/soko-bot.schema";
import { sokoBotPendingDecisionSchema } from "@/schemas/soko-bot-pending-decision.schema";
import { sokoBotRuntimeService } from "@/services/soko-bot-runtime.service";
import {
  requireReachableSokoBot,
  sokoBotIdParams,
} from "../../../bot-selector.js";
import { decisionParams, mapControlPlaneError } from "../../../helpers.js";

const body = {
  content: {
    "application/json": { schema: resolveSokoBotDecisionRequestSchema },
  },
};

const spec = {
  method: "post" as const,
  tags: ["Soko Bots"],
  responses: {
    200: jsonSuccessResponse(
      sokoBotPendingDecisionSchema,
      "Resolve Soko Bot decision",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse(
      "Forbidden: on a shared Soko Bot, only the member who asked or an organization owner or admin",
    ),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
};

const resolveDecisionRoute = createRoute({
  ...spec,
  path: "/me/decisions/{decisionId}",
  operationId: "resolveMySokoBotDecision",
  request: { params: decisionParams, body },
});

const resolveDecisionByIdRoute = createRoute({
  ...spec,
  path: "/{sokoBotId}/decisions/{decisionId}",
  operationId: "resolveSokoBotDecision",
  request: { params: decisionParams.extend(sokoBotIdParams.shape), body },
  responses: { ...spec.responses, 404: jsonErrorResponse("Not Found") },
});

async function handle(
  c: Context<EnvVariables>,
  decisionId: string,
  input: z.infer<typeof resolveSokoBotDecisionRequestSchema>,
  sokoBotId?: string,
) {
  const auth = requireUserAuthContext(c.var.authContext);
  try {
    if (sokoBotId) {
      const bot = await requireReachableSokoBot(
        auth.userId,
        requireWorkspaceContext(c.var.workspaceContext).workspaceId,
        sokoBotId,
      );
      const decision = await prisma.sokoBotPendingDecision.findFirst({
        where: { id: decisionId, sokoBotId: bot.id },
        select: { id: true },
      });
      if (!decision) throw notFound("Soko Bot decision not found");
    }
    const decision = await sokoBotRuntimeService.resolveDecision(
      auth.userId,
      decisionId,
      input.resolution === "ACCEPT",
    );
    return ok(c, sokoBotPendingDecisionSchema.parse(decision));
  } catch (error) {
    mapControlPlaneError(error);
  }
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(resolveDecisionRoute, (c) =>
    handle(c, c.req.valid("param").decisionId, c.req.valid("json")),
  );
}

export function mountById(app: OpenAPIHonoWithAuth) {
  app.openapi(resolveDecisionByIdRoute, (c) => {
    const { decisionId, sokoBotId } = c.req.valid("param");
    return handle(c, decisionId, c.req.valid("json"), sokoBotId);
  });
}
