import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

import {
  getGoogleDriveCredentials,
  getGoogleDriveRedirectUri,
} from "./utils.js";

const connectResponseSchema = z.object({
  url: z.string(),
});

const route = createRoute({
  method: "post",
  path: "/google-drive/connect",
  description: "Start Google Drive OAuth flow. Returns the authorization URL.",
  tags: ["Google Drive"],
  responses: {
    200: jsonSuccessResponse(
      connectResponseSchema,
      "Google Drive OAuth authorization URL",
    ),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    503: jsonErrorResponse("Service Unavailable"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireUserAuthContext(c.var.authContext);

    const { clientId } = getGoogleDriveCredentials();
    const redirectUri = getGoogleDriveRedirectUri();

    const scopes = [
      "https://www.googleapis.com/auth/drive.file",
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/userinfo.email",
    ];

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return ok(c, { url });
  });
}
