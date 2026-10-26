import { createRoute } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import {
  driveShareSchema,
  toDriveShareDto,
  upsertDriveShareRequestSchema,
} from "@/schemas/drive-share.schema";
import { upsertDriveShare } from "@/services/drive-share.service";
import { driveShareTarget } from "./target.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/",
    description: [
      "Create the public link of a Drive file or folder, or change its password.",
      "Anyone with the link sees the file, or the folder as it is now, subfolders included.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: upsertDriveShareRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(driveShareSchema, "Share"),
      400: jsonErrorResponse("Bad Request"),
      401: jsonErrorResponse("Unauthorized"),
      403: jsonErrorResponse("Forbidden"),
      404: jsonErrorResponse("Not Found"),
    },
  }),
);

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const body = c.req.valid("json");
    const store = await resolveFileRequestContext({
      authContext: c.var.authContext,
      scope: body.scope,
      organizationId: body.organizationId,
    });
    const share = await upsertDriveShare({
      store,
      target: driveShareTarget(body),
      password: body.password,
      userId: store.actor.userId,
    });
    return ok(c, driveShareSchema.parse(toDriveShareDto(share)));
  });
}
