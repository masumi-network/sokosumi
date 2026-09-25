import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { AgentGrantContext } from "@/routes/image-studio-agent/authorize";
import {
  registerImageStudioSessionRequestSchema,
  registerImageStudioSessionSchema,
} from "@/schemas/project-image-studio.schema";
import { registerCreatedSession } from "@/services/image-studio-sessions.service";

/**
 * Record a conversation the image-studio agent has just created.
 *
 * The agent calls this from inside its own create request, before the new eve
 * session id has reached anybody and before the conversation's first message
 * is delivered. Only the agent can reach this surface — the token the browser
 * holds carries a different audience — so reaching it is itself the proof of
 * creation that possession of an id never was.
 */
const route = createRoute({
  method: "post",
  path: "/sessions",
  description:
    "Record an eve session the agent has just created against its project. Repeating the call for a session the same project already owns returns the existing record with created=false, so the conversation's first message is not delivered twice.",
  tags: ["Image studio agent"],
  request: {
    body: {
      required: true,
      content: {
        "application/json": {
          schema: registerImageStudioSessionRequestSchema,
        },
      },
    },
  },
  responses: {
    201: jsonSuccessResponse(
      registerImageStudioSessionSchema,
      "Conversation recorded",
    ),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Conflict"),
  },
});

export default function mount(
  app: OpenAPIHono<{ Variables: { agentGrant: AgentGrantContext } }>,
): void {
  app.openapi(route, async (c) => {
    const context = c.var.agentGrant;
    const input = c.req.valid("json");

    const session = await registerCreatedSession({
      projectId: context.projectId,
      userId: context.userId,
      eveSessionId: input.eveSessionId,
      title: input.title ?? null,
    });

    return created(c, {
      sessionId: session.id,
      created: session.wasCreated,
    });
  });
}
