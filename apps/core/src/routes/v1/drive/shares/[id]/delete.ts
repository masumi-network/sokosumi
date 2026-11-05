import { createRoute, z } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse } from "@/helpers/openapi";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { driveFileScopeSchema } from "@/schemas/drive-file.schema";
import { deleteDriveShare } from "@/services/drive-share.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "delete",
    path: "/{id}",
    description: "Stop sharing: the link stops working at once.",
    tags: ["Drive"],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({
        scope: driveFileScopeSchema,
        organizationId: z.string().optional(),
      }),
    },
    responses: {
      204: { description: "Link revoked" },
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const query = c.req.valid("query");
    const store = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope: query.scope,
      organizationId: query.organizationId,
    });
    await deleteDriveShare(store, c.req.valid("param").id);
    return c.body(null, 204);
  });
}
