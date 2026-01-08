import { randomBytes, randomUUID } from "node:crypto";

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
import { createRoute, z } from "@hono/zod-openapi";

import { jsonErrorResponse, jsonSuccessResponse } from "@/helpers/openapi";
import { created } from "@/helpers/response";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";

/**
 * Generates a PKCE code verifier according to OAuth 2.1 spec.
 * Code verifier must be 43-128 characters, URL-safe base64 encoded random string.
 */
function generateCodeVerifier(): string {
  const array = randomBytes(32);
  return base64Url.encode(array, { padding: false });
}

/**
 * Generates a PKCE code challenge using S256 method (SHA256).
 * Code challenge = Base64url(SHA256(ASCII(code_verifier)))
 */
async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await createHash("SHA-256").digest(
    new TextEncoder().encode(verifier),
  );
  return base64Url.encode(new Uint8Array(hash), { padding: false });
}

const pkceResponseSchema = z
  .object({
    codeVerifier: z.string().openapi({
      example: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
      description:
        "PKCE code verifier (43-128 characters, URL-safe base64 encoded)",
    }),
    codeChallenge: z.string().openapi({
      example: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      description:
        "PKCE code challenge (SHA256 hash of code verifier, base64url encoded)",
    }),
    state: z.string().uuid().openapi({
      example: "550e8400-e29b-41d4-a716-446655440000",
      description: "OAuth state parameter (UUID)",
    }),
  })
  .openapi("PKCEResponse");

const route = createRoute({
  method: "post",
  path: "/pkce",
  tags: ["OAuth"],
  summary: "Generate PKCE (Debug)",
  description:
    "Generates PKCE (Proof Key for Code Exchange) values including code verifier, code challenge, and state for OAuth 2.1 authorization flow debugging.",
  responses: {
    201: jsonSuccessResponse(
      pkceResponseSchema,
      "PKCE values generated successfully",
      {
        data: {
          codeVerifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
          codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
          state: "550e8400-e29b-41d4-a716-446655440000",
        },
        meta: {
          timestamp: "2025-01-15T12:00:00.000Z",
          requestId: "550e8400-e29b-41d4-a716-446655440000",
        },
      },
    ),
    401: jsonErrorResponse("Unauthorized"),
    500: jsonErrorResponse("Internal Server Error"),
  },
});

export default function mount(app: OpenAPIHonoWithAuth) {
  app.openapi(route, async (c) => {
    // Generate PKCE parameters for OAuth 2.1 authorization code flow with PKCE
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = randomUUID();

    return created(c, {
      codeVerifier,
      codeChallenge,
      state,
    });
  });
}
