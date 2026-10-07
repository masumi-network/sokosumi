import { hasRequestState } from "@better-auth/core/context";
import { getOAuthProviderState } from "@better-auth/oauth-provider";

import prisma from "@/lib/db/prisma";
import { tryUseLogger } from "@/lib/evlog";

import { parseSignUpContextEntries } from "./auth-sign-up-context-entries";

/*
 * Every account records its sign-up origin and sign-up context once, when
 * Core creates the user (ADR 0052). The origin comes from the `signUpOrigin`
 * of the OAuth client the sign-up came through, never from the request.
 */

/** Origin of a sign-up outside an OAuth request. */
const SOKOSUMI_ORIGIN = "sokosumi";
/** Origin of a sign-up through a client without a `signUpOrigin`. */
const UNKNOWN_ORIGIN = "unknown";

/**
 * The authorize query of the OAuth request this sign-up came through, or
 * null outside one. Email code and password sign-ups carry it as the signed
 * `oauth_query`, which the OAuth provider keeps in its per-request state.
 */
async function readOAuthSignUpRequest(): Promise<URLSearchParams | null> {
  if (!(await hasRequestState())) {
    return null;
  }
  const query = (await getOAuthProviderState())?.query;
  return query ? new URLSearchParams(query) : null;
}

async function originOf(clientId: string): Promise<string> {
  const client = await prisma.oauthClient.findUnique({
    where: { clientId },
    select: { signUpOrigin: true },
  });
  return client?.signUpOrigin ?? UNKNOWN_ORIGIN;
}

async function writeSignUpContext(userId: string): Promise<void> {
  const request = await readOAuthSignUpRequest();
  const clientId = request?.get("client_id") ?? null;
  await prisma.signUpContext.create({
    data: {
      userId,
      origin: clientId ? await originOf(clientId) : SOKOSUMI_ORIGIN,
      entries: parseSignUpContextEntries(
        request?.get("signup_context") ?? null,
      ),
      clientId,
    },
  });
}

/**
 * Records the sign-up of a user Core just created. A failure is logged and
 * never fails the sign-up.
 */
export async function recordSignUpContext(userId: string): Promise<void> {
  await writeSignUpContext(userId).catch((error: Error) => {
    tryUseLogger()?.error(error, { signUpContext: { userId } });
  });
}
