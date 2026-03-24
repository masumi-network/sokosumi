import { createRoute, z } from "@hono/zod-openapi";

import { getBetterAuthPublicBaseUrl, getWebAppBaseUrl } from "@/config/env";
import { conflict } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { ok } from "@/helpers/response";
import { auth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";

const oauthAuthorizeSchema = z
  .object({
    response_type: z.enum(["code"]).openapi({
      description: "OAuth2 authorize response type",
      example: "code",
    }),
    client_id: z.string().trim().min(1).openapi({
      description: "OAuth2 client ID",
      example: "client_123",
    }),
    redirect_uri: z.url().optional().openapi({
      description: "OAuth2 redirect URI",
      example: "https://consumer.example.com/callback",
    }),
    scope: z.string().trim().min(1).optional().openapi({
      description: "OAuth2 scopes (space-separated)",
      example: "openid offline_access",
    }),
    state: z.string().trim().min(1).optional().openapi({
      description: "OAuth2 state parameter",
      example: "opaque-state",
    }),
    code_challenge: z.string().trim().min(1).optional().openapi({
      description: "PKCE code challenge",
      example: "pkce-challenge",
    }),
    code_challenge_method: z.enum(["S256"]).optional().openapi({
      description: "PKCE code challenge method",
      example: "S256",
    }),
    nonce: z.string().trim().min(1).optional().openapi({
      description: "OpenID Connect nonce",
      example: "nonce_123",
    }),
    prompt: z.string().trim().min(1).optional().openapi({
      description: "OAuth2 prompt parameter",
      example: "consent login",
    }),
  })
  .openapi({
    description:
      "Optional OAuth2 authorize request to start after magic-link verification",
  });

const requestSchema = z.object({
  email: z
    .email()
    .transform((val) => val.toLowerCase())
    .openapi({
      description: "Email address to send the magic link to",
      example: "new.user@example.com",
    }),
  name: z.string().trim().min(1).optional().openapi({
    description: "Optional display name for first-time signup",
    example: "New User",
  }),
  oauth: oauthAuthorizeSchema.optional(),
});

const responseSchema = z.object({
  status: z.boolean().openapi({
    description: "Whether the magic link request was accepted",
    example: true,
  }),
});

const route = createRoute({
  method: "post",
  path: "/",
  tags: ["Users"],
  description: "Send a new-user magic link invite (coworker only)",
  request: {
    body: {
      content: {
        "application/json": {
          schema: requestSchema,
        },
      },
    },
  },
  responses: {
    200: jsonSuccessResponse(responseSchema, "Magic link invite sent", {
      data: {
        status: true,
      },
      meta: {
        timestamp: "2025-01-01T00:00:00.000Z",
        requestId: "550e8400-e29b-41d4-a716-446655440000",
      },
    }),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    409: jsonErrorResponse("Conflict"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

function getWebAppRootUrl(): string {
  return new URL("/", getWebAppBaseUrl()).toString();
}

type OAuthAuthorizeRequest = z.infer<typeof oauthAuthorizeSchema>;

function buildOAuthAuthorizeUrl(oauth: OAuthAuthorizeRequest): string {
  const authorizeUrl = new URL(
    `/auth/oauth2/authorize`,
    getBetterAuthPublicBaseUrl(),
  );

  const entries = [
    ["response_type", oauth.response_type],
    ["client_id", oauth.client_id],
    ["redirect_uri", oauth.redirect_uri],
    ["scope", oauth.scope],
    ["state", oauth.state],
    ["code_challenge", oauth.code_challenge],
    ["code_challenge_method", oauth.code_challenge_method],
    ["nonce", oauth.nonce],
    ["prompt", oauth.prompt],
  ] as const;

  for (const [key, value] of entries) {
    if (value) {
      authorizeUrl.searchParams.set(key, value);
    }
  }

  return authorizeUrl.toString();
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    requireCoworkerAuthContext(c.var.authContext);

    const { email, name, oauth } = c.req.valid("json");
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      throw conflict("User is already registered");
    }

    const callbackURL = oauth
      ? buildOAuthAuthorizeUrl(oauth)
      : getWebAppRootUrl();
    const body = {
      email,
      callbackURL,
      newUserCallbackURL: callbackURL,
      ...(name ? { name } : {}),
    };

    const result = await auth.api.signInMagicLink({
      body,
      headers: c.req.raw.headers,
    });

    return ok(c, {
      status: result.status,
    });
  });
}
