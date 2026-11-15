import { createRoute } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  driveStarsQuerySchema,
  driveStarsSchema,
} from "@/schemas/drive-star.schema";
import { listDriveStars } from "@/services/drive-star.service";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: [
      "The files and folders the caller starred in this Files workspace, newest first.",
      "Only what the caller can open now is listed.",
    ].join("\n"),
    tags: ["Drive"],
    request: { query: driveStarsQuerySchema },
    responses: {
      200: jsonSuccessResponse(driveStarsSchema, "Stars"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
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
    return ok(c, driveStarsSchema.parse(await listDriveStars(store)));
  });
}
