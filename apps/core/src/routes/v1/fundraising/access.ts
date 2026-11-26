import { createRoute } from "@hono/zod-openapi";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { requireWorkspaceContext } from "@/middleware/workspace";
import { fundraisingAccessSchema } from "@/schemas/fundraising.schema";
import { fundraisingEnabled } from "@/services/fundraising.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/access",
    tags: ["Fundraising"],
    description:
      "Whether this workspace has Fundraising. Pages link to it only when it does.",
    responses: {
      200: jsonSuccessResponse(fundraisingAccessSchema, "Access"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const workspace = requireWorkspaceContext(c.var.workspaceContext);
    return ok(
      c,
      fundraisingAccessSchema.parse({
        enabled: fundraisingEnabled(workspace.organizationId),
      }),
    );
  });
}
