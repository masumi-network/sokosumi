import { createRoute, z } from "@hono/zod-openapi";

import { getWebAppBaseUrl } from "@/config/env";
import { badRequest } from "@/helpers/error";
import { jsonErrorResponse } from "@/helpers/openapi";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireUserAuthContext } from "@/middleware/auth";

import {
  getGoogleDriveCredentials,
  getGoogleDriveRedirectUri,
} from "./utils.js";

const querySchema = z.object({
  code: z.string().min(1),
  error: z.string().optional(),
});

const route = createRoute({
  method: "get",
  path: "/google-drive/callback",
  description: "Google Drive OAuth callback. Exchanges code for tokens.",
  tags: ["Google Drive"],
  request: {
    query: querySchema,
  },
  responses: {
    302: {
      description: "Redirect back to connections page after successful auth",
    },
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireUserAuthContext(c.var.authContext);
    const { code, error } = c.req.valid("query");

    if (error) {
      throw badRequest(`Google OAuth error: ${error}`);
    }

    const { clientId, clientSecret } = getGoogleDriveCredentials();
    const redirectUri = getGoogleDriveRedirectUri();

    // Exchange authorization code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      throw badRequest(`Failed to exchange authorization code: ${body}`);
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    };

    if (!tokenData.refresh_token) {
      throw badRequest(
        "No refresh token received. Please revoke access and try again.",
      );
    }

    // Fetch user email from Google userinfo
    let email: string | null = null;
    try {
      const userinfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
      );
      if (userinfoRes.ok) {
        const userinfo = (await userinfoRes.json()) as { email?: string };
        email = userinfo.email ?? null;
      }
    } catch {
      // Non-critical -- email is optional
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    // Upsert the connection
    await prisma.googleDriveConnection.upsert({
      where: { userId: authContext.userId },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scope: tokenData.scope,
        email,
      },
      create: {
        userId: authContext.userId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt,
        scope: tokenData.scope,
        email,
      },
    });

    // Redirect back to the connections page
    const webBaseUrl = getWebAppBaseUrl();
    return c.redirect(`${webBaseUrl}/connections`);
  });
}
