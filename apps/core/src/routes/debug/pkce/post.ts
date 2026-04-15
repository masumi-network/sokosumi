import { randomBytes, randomUUID } from "node:crypto";

import { base64Url } from "@better-auth/utils/base64";
import { createHash } from "@better-auth/utils/hash";
import type { Hono } from "hono";

import { created } from "@/helpers/response";

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

export default function mount(app: Hono) {
  app.post("/pkce", async (c) => {
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
