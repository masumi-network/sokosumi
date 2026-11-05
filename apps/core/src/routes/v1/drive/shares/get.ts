import { createRoute } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  driveShareQuerySchema,
  driveShareResponseSchema,
  toDriveShareDto,
} from "@/schemas/drive-share.schema";
import { findDriveShare } from "@/services/drive-share.service";
import { driveShareTarget } from "./target.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "get",
    path: "/",
    description: "The public link of one Drive file or folder, if it has one.",
    tags: ["Drive"],
    request: { query: driveShareQuerySchema },
    responses: {
      200: jsonSuccessResponse(driveShareResponseSchema, "Share"),
      400: jsonErrorResponse("Bad Request"),
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
    const share = await findDriveShare(store, driveShareTarget(query));
    return ok(
      c,
      driveShareResponseSchema.parse({
        share: share ? toDriveShareDto(share) : null,
      }),
    );
  });
}
