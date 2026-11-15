import { createRoute } from "@hono/zod-openapi";

import { resolveFileRequestContext } from "@/helpers/file-workspace";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import {
  type OpenAPIHonoWithAuth,
  withCoworkerContextHeaderParameters,
} from "@/lib/hono";
import { setDriveStarRequestSchema } from "@/schemas/drive-star.schema";
import { setDriveStar } from "@/services/drive-star.service";
import { driveShareTarget } from "../shares/target.js";

const route = withCoworkerContextHeaderParameters(
  createRoute({
    method: "put",
    path: "/",
    description: [
      "Star or unstar one Drive file or folder for the caller only.",
      "Starring needs access to it now; 404 when the caller cannot open it.",
    ].join("\n"),
    tags: ["Drive"],
    request: {
      body: {
        required: true,
        content: {
          "application/json": { schema: setDriveStarRequestSchema },
        },
      },
    },
    responses: {
      200: jsonSuccessResponse(setDriveStarRequestSchema, "Star set"),
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
    await setDriveStar({
      store,
      target: driveShareTarget(body),
      starred: body.starred,
    });
    return ok(c, body);
  });
}
