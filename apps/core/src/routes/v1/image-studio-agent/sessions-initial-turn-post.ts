import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { AgentGrantContext } from "@/routes/image-studio-agent/authorize";
import {
  recordImageStudioInitialTurnRequestSchema,
  recordImageStudioInitialTurnSchema,
} from "@/schemas/project-image-studio.schema";
import { transitionInitialTurn } from "@/services/image-studio-sessions.service";

/**
 * Move the first-message delivery the agent is holding, or ask to hold it.
 *
 * Delivery happens outside Core — the agent dispatches into its own runtime —
 * so both the intention and the outcome have to be told to Core explicitly.
 * `claim` is how an ordinary send into a conversation that still owes its
 * first message enters the same decision creation does; without it, such a
 * send delivered the message while the state still said nobody had, and a
 * retry of the original creation could dispatch the same text again.
 *
 * Without a closing call the conversation stays in DELIVERING until its lease
 * runs out, and a lapsed lease resolves to UNCERTAIN rather than to a
 * redelivery, which is the conservative end of the only two mistakes here.
 *
 * `undelivered` is what makes an honest retry possible: the runtime answered
 * and refused, so the message is owed again and the next attempt may send it.
 */
const route = createRoute({
  method: "post",
  path: "/sessions/{eveSessionId}/initial-turn",
  description:
    "Move the conversation's first-message delivery, fenced on the lease token. 'claim' asks for the right to deliver and returns the lease; 'dispatching' is announced before the send and requires that lease; 'delivered' closes it; 'undelivered' returns it to the queue for a later attempt; 'uncertain' leaves it in a state nothing redelivers automatically. accepted=false means this caller does not hold the delivery and must not send.",
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
    const { transition, deliveryToken } = c.req.valid("json");

    const session = await transitionInitialTurn({
      projectId: context.projectId,
      userId: context.userId,
      eveSessionId,
      transition,
      deliveryToken: deliveryToken ?? null,
    });

    return ok(c, {
      sessionId: session.id,
      eveSessionId: session.eveSessionId,
      initialTurn: session.initialTurn,
      accepted: session.accepted,
      mayDeliver: session.mayDeliver,
      deliveryToken: session.deliveryToken,
    });
  });
}
