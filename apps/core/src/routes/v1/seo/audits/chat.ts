import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { requireSeoRouteActor } from "@/helpers/project-seo-access";
import { ok } from "@/helpers/response";
import {
  createNestedOpenAPIHono,
  withOrganizationSlugHeaderParameter,
} from "@/lib/hono";
import { seoProjectParamsSchema } from "@/schemas/project-seo.schema";
import {
  sendSeoChatSchema,
  seoChatHistorySchema,
  seoChatTurnSchema,
} from "@/schemas/seo-chat.schema";
import { listSeoChat, sendSeoChat } from "@/services/seo-chat.service";

const app = createNestedOpenAPIHono();
const errors = {
  400: jsonErrorResponse("Invalid message"),
  401: jsonErrorResponse("Unauthorized"),
  403: jsonErrorResponse("Forbidden"),
  404: jsonErrorResponse("Audit not found"),
  409: jsonErrorResponse("Conversation changed or reply in progress"),
  429: jsonErrorResponse("Daily SEO chat allowance used"),
  503: jsonErrorResponse("SEO chat unavailable"),
};

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "get",
      path: "/",
      operationId: "listSeoAuditChat",
      tags: ["SEO"],
      request: { params: seoProjectParamsSchema },
      responses: {
        200: jsonSuccessResponse(seoChatHistorySchema, "Audit conversation"),
        ...errors,
      },
    }),
  ),
  async (c) => {
    const actor = requireSeoRouteActor(c.var, {
      kind: "audit",
      id: c.req.valid("param").id,
    });
    return ok(c, await listSeoChat(actor));
  },
);

app.openapi(
  withOrganizationSlugHeaderParameter(
    createRoute({
      method: "post",
      path: "/",
      operationId: "sendSeoAuditChat",
      tags: ["SEO"],
      request: {
        params: seoProjectParamsSchema,
        body: {
          content: { "application/json": { schema: sendSeoChatSchema } },
          required: true,
        },
      },
      responses: {
        200: jsonSuccessResponse(
          seoChatTurnSchema,
          "Audit reply or existing request",
        ),
        ...errors,
      },
    }),
  ),
  async (c) => {
    const actor = requireSeoRouteActor(c.var, {
      kind: "audit",
      id: c.req.valid("param").id,
    });
    return ok(c, await sendSeoChat(actor, c.req.valid("json")));
  },
);

export default app;
