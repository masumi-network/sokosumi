import { createRoute, z } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";
import { rethrow } from "@/routes/v1/cmo/helpers";
import { cmoProjectParamsSchema } from "@/schemas/cmo.schema";
import { markCmoUpgradeSeen } from "@/services/cmo-upgrade.service";

const body = z
  .object({ versionId: z.string().min(1).max(64) })
  .openapi("CmoUpgradeSeen");

const route = createRoute({
  method: "post",
  path: "/projects/{projectId}/upgrade-seen",
  operationId: "markCmoUpgradeSeenForProject",
  tags: ["CMO"],
  description:
    "The member closed the dialog that says what changed when Cuso moved onto this version; the overview's `upgrade` stays null for them until his next move.",
  request: {
    params: cmoProjectParamsSchema,
    body: {
      required: true,
      content: { "application/json": { schema: body } },
    },
  },
  responses: {
    200: jsonSuccessResponse(body, "The dialog stays closed for this member"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Cuso is not hired yet"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const { userId } = requireUserAuthContext(c.var.authContext);
    const { projectId } = c.req.valid("param");
    const { versionId } = c.req.valid("json");
    await markCmoUpgradeSeen({ userId, projectId }, versionId).catch(rethrow);
    return ok(c, { versionId });
  });
}
