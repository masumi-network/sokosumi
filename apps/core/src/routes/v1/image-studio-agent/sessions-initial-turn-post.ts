import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { AgentGrantContext } from "@/routes/image-studio-agent/authorize";
import {
  recordImageStudioInitialTurnRequestSchema,
  recordImageStudioInitialTurnSchema,
} from "@/schemas/project-image-studio.schema";
import { recordInitialTurn } from "@/services/image-studio-sessions.service";

/**
 * Close out the first-message delivery the agent was holding.
 *
 * Delivery happens outside Core — the agent dispatches into its own runtime —
 * so what happened has to be told to Core explicitly. Without this call the
 * conversation stays in DELIVERING until its lease runs out, and a lapsed
 * lease resolves to UNCERTAIN rather than to a redelivery, which is the
 * conservative end of the only two mistakes available here.
 *
 * `undelivered` is what makes an honest retry possible: the runtime answered
 * and refused, so the message is owed again and the next attempt may send it.
 */
const route = createRoute({
  method: "post",
  path: "/sessions/{eveSessionId}/initial-turn",
  description:
    "Move the conversation's first-message delivery, fenced on the lease token. 'dispatching' is announced before the send; 'delivered' closes it; 'undelivered' returns it to the queue for a later attempt; 'uncertain' leaves it in a state nothing redelivers automatically. accepted=false means another attempt now holds the lease and this caller must not send.",
  tags: ["Image studio agent"],
  request: {
    params: z.object({
      eveSessionId: z.string().min(1).max(200),
    }),
    body: {
      required: true,
      content: {
        "application/json": {
          schema: recordImageStudioInitialTurnRequestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(
      recordImageStudioInitialTurnSchema,
      "First-message state recorded",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
    503: jsonErrorResponse("Service Unavailable"),
  },
});

export default function mount(
  app: OpenAPIHono<{ Variables: { agentGrant: AgentGrantContext } }>,
): void {
  app.openapi(route, async (c) => {
    const context = c.var.agentGrant;
    const { eveSessionId } = c.req.valid("param");
    const { outcome, deliveryToken } = c.req.valid("json");

    const session = await recordInitialTurn({
      projectId: context.projectId,
      userId: context.userId,
      eveSessionId,
      outcome,
      deliveryToken: deliveryToken ?? null,
    });

    return ok(c, {
      sessionId: session.id,
      eveSessionId: session.eveSessionId,
      initialTurn: session.initialTurn,
      accepted: session.accepted,
    });
  });
}
