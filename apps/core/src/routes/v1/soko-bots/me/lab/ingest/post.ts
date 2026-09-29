import { createRoute } from "@hono/zod-openapi";
import { badRequest, conflict, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { type OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { requireWorkspaceContext } from "@/middleware/workspace";
import {
  sokoBotLabIngestRequestSchema,
  sokoBotLabIngestSchema,
} from "@/schemas/soko-bot.schema";
import {
  runSokoBotLabIngest,
  SokoBotLabBusyError,
  SokoBotLabIngestError,
  SokoBotLabMissingIntegrationError,
} from "@/services/soko-bot-lab-ingest.service";
import { mapControlPlaneError } from "../../../helpers.js";

const labIngestRoute = createRoute({
  method: "post",
  path: "/me/lab/ingest",
  operationId: "runMySokoBotLabIngest",
  tags: ["Soko Bots"],
  request: {
    body: {
      content: {
        "application/json": { schema: sokoBotLabIngestRequestSchema },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(sokoBotLabIngestSchema, "Turn started"),
    400: jsonErrorResponse("A required account is not connected"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    409: jsonErrorResponse("Soko Bot cannot take a turn right now"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

// The proactive rhythms, on demand. They were CLI-only because the CLI can
// set a process-wide fixtures env var; but the packet builders read whatever
// the bot has connected, so nothing about them needs a terminal.

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(labIngestRoute, async (c) => {
    const auth = requireUserAuthContext(c.var.authContext);
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    try {
      const result = await runSokoBotLabIngest({
        userId: auth.userId,
        workspaceId: workspace.workspaceId,
        ...c.req.valid("json"),
      });
      return ok(c, sokoBotLabIngestSchema.parse(result));
    } catch (error) {
      // Named separately from "not found": the scenario is runnable, the owner
      // just has to connect the account it reads from first.
      if (error instanceof SokoBotLabMissingIntegrationError) {
        throw badRequest(error.message);
      }
      if (error instanceof SokoBotLabBusyError) throw conflict(error.message);
      if (error instanceof SokoBotLabIngestError) throw notFound(error.message);
      // It starts a real turn, so it can fail every way starting one can:
      // out of credits, aborted, already working, a stale idempotency key.
      mapControlPlaneError(error);
    }
  });
}
