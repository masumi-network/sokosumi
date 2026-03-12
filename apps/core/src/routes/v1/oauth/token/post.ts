import { randomBytes } from "node:crypto";

import { createRoute, z } from "@hono/zod-openapi";
import { SignJWT } from "jose";

import { getEnv } from "@/config/env";
import { requireCoworkerCapability } from "@/helpers/access-control";
import { badRequest, forbidden, notFound } from "@/helpers/error";
import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import { hashApiKey } from "@/lib/coworker-api-key";
import prisma from "@/lib/db/prisma";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { requireCoworkerAuthContext } from "@/middleware/auth";

const ACCESS_TOKEN_PREFIX = "soko_access_token_";
const REFRESH_TOKEN_PREFIX = "soko_refresh_token_";
const ACCESS_TOKEN_EXPIRES_IN_SECONDS = 7_200;
const REFRESH_TOKEN_EXPIRES_IN_SECONDS = 7_776_000;
const ID_TOKEN_EXPIRES_IN_SECONDS = 72_000;

const requestSchema = z.object({
  userId: z.string().min(1).openapi({ example: "user_123" }),
  clientId: z.string().min(1).openapi({ example: "client_123" }),
});

const responseSchema = z.object({
  authorizationConfirmed: z.literal(true),
  accessToken: z.string().openapi({ example: "soko_access_token_xxx" }),
  tokenType: z.literal("Bearer").openapi({ example: "Bearer" }),
  expiresIn: z.number().int().positive().openapi({ example: 7200 }),
  refreshToken: z.string().openapi({ example: "soko_refresh_token_xxx" }),
  scope: z.string().openapi({ example: "openid offline_access" }),
  id_token: z.string().openapi({ example: "eyJhbGciOiJIUzI1NiJ9.xxx.yyy" }),
});

const route = createRoute({
  method: "post",
  path: "/token",
  description:
    "Issue Sokosumi OAuth tokens for current coworker in background flow",
  tags: ["Coworkers"],
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
    201: jsonSuccessResponse(responseSchema, "OAuth background token issued"),
    400: jsonErrorResponse("Bad Request"),
    401: jsonErrorResponse("Unauthorized"),
    403: jsonErrorResponse("Forbidden"),
    404: jsonErrorResponse("Not Found"),
    422: jsonErrorResponse("Unprocessable Entity"),
  },
});

function generateTokenPart(): string {
  return randomBytes(32).toString("base64url");
}

function parseScope(scope: string | undefined): string[] {
  if (!scope) return [];
  return scope
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveScopes(
  requestedScope: string | undefined,
  clientScopes: string[],
) {
  const requested = parseScope(requestedScope);
  if (requested.length === 0) {
    return clientScopes.length > 0
      ? clientScopes
      : ["openid", "offline_access"];
  }

  const allowedScopes = new Set(clientScopes);
  if (clientScopes.length > 0) {
    const hasInvalidScope = requested.some(
      (scope) => !allowedScopes.has(scope),
    );
    if (hasInvalidScope) {
      throw forbidden("Requested scope is not allowed for OAuth client");
    }
  }

  return requested;
}

function ensureOpenIdScope(scopes: string[]) {
  return scopes.includes("openid") ? scopes : ["openid", ...scopes];
}

function isClientMappedToCoworker(
  oauthClient: { referenceId: string | null; metadata: unknown },
  coworker: { id: string; slug: string },
): boolean {
  if (
    oauthClient.referenceId === coworker.id ||
    oauthClient.referenceId === coworker.slug
  ) {
    return true;
  }

  if (!oauthClient.metadata || typeof oauthClient.metadata !== "object") {
    return false;
  }

  const metadata = oauthClient.metadata as Record<string, unknown>;
  const metadataCoworkerId = metadata.coworkerId;
  const metadataCoworkerSlug = metadata.coworkerSlug;

  return (
    metadataCoworkerId === coworker.id || metadataCoworkerSlug === coworker.slug
  );
}

async function createIdToken(
  userId: string,
  clientId: string,
  issuedAtMs: number,
): Promise<string> {
  const env = getEnv();
  const issuer = `${env.BETTER_AUTH_URL}/api/auth`;
  const issuedAt = Math.floor(issuedAtMs / 1000);
  const signingSecret = new TextEncoder().encode(env.BETTER_AUTH_SECRET);

  return await new SignJWT({
    auth_time: issuedAt,
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(clientId)
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ID_TOKEN_EXPIRES_IN_SECONDS)
    .sign(signingSecret);
}

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    const authContext = requireCoworkerAuthContext(c.var.authContext);
    await requireCoworkerCapability(authContext.coworkerId, "chat");

    const { userId, clientId } = c.req.valid("json");

    const coworker = await prisma.coworker.findFirst({
      where: {
        id: authContext.coworkerId,
        archivedAt: null,
      },
      select: {
        id: true,
        slug: true,
        isWhitelisted: true,
      },
    });

    if (!coworker) {
      throw notFound("Coworker not found");
    }

    if (!coworker.isWhitelisted) {
      throw forbidden("Coworker is not whitelisted");
    }

    const oauthClient = await prisma.oauthClient.findUnique({
      where: {
        clientId,
      },
      select: {
        clientId: true,
        disabled: true,
        scopes: true,
        referenceId: true,
        metadata: true,
      },
    });

    if (!oauthClient || oauthClient.disabled) {
      throw forbidden("OAuth client is not available");
    }

    if (!isClientMappedToCoworker(oauthClient, coworker)) {
      throw forbidden("OAuth client is not mapped to coworker");
    }

    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
      },
    });

    if (!user) {
      throw badRequest("User not found");
    }

    const resolvedScopes = resolveScopes(undefined, oauthClient.scopes);
    const scopes = ensureOpenIdScope(resolvedScopes);
    if (scopes.length === 0) {
      throw badRequest("OAuth scopes are required");
    }

    const accessTokenPart = generateTokenPart();
    const refreshTokenPart = generateTokenPart();

    const accessToken = `${ACCESS_TOKEN_PREFIX}${accessTokenPart}`;
    const refreshToken = `${REFRESH_TOKEN_PREFIX}${refreshTokenPart}`;

    const accessTokenHash = await hashApiKey(accessTokenPart);
    const refreshTokenHash = await hashApiKey(refreshTokenPart);

    const now = Date.now();
    const idToken = await createIdToken(userId, clientId, now);
    const accessTokenExpiresAt = new Date(
      now + ACCESS_TOKEN_EXPIRES_IN_SECONDS * 1000,
    );
    const refreshTokenExpiresAt = new Date(
      now + REFRESH_TOKEN_EXPIRES_IN_SECONDS * 1000,
    );

    await prisma.$transaction(async (tx) => {
      const existingConsent = await tx.oauthConsent.findFirst({
        where: {
          userId,
          clientId,
        },
        select: {
          id: true,
        },
      });

      if (!existingConsent) {
        await tx.oauthConsent.create({
          data: {
            userId,
            clientId,
            scopes,
            referenceId: coworker.id,
          },
        });
      }

      const refreshTokenRecord = await tx.oauthRefreshToken.create({
        data: {
          token: refreshTokenHash,
          clientId,
          userId,
          referenceId: coworker.id,
          scopes,
          expiresAt: refreshTokenExpiresAt,
          revoked: null,
          authTime: new Date(now),
        },
        select: {
          id: true,
        },
      });

      await tx.oauthAccessToken.create({
        data: {
          token: accessTokenHash,
          clientId,
          userId,
          referenceId: coworker.id,
          scopes,
          expiresAt: accessTokenExpiresAt,
          refreshId: refreshTokenRecord.id,
        },
      });
    });

    return created(
      c,
      responseSchema.parse({
        authorizationConfirmed: true,
        accessToken,
        tokenType: "Bearer",
        expiresIn: ACCESS_TOKEN_EXPIRES_IN_SECONDS,
        refreshToken,
        scope: scopes.join(" "),
        id_token: idToken,
      }),
    );
  });
}
