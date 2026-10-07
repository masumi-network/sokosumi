import prisma from "@/lib/db/prisma";
import { tryUseLogger } from "@/lib/evlog";

import { readOAuthAuthorizeQuery } from "./auth-oauth-provider";
import { parseSignUpContextEntries } from "./auth-sign-up-context-entries";

/*
 * Every account records its sign-up origin and sign-up context once, when
 * Core creates the user (ADR 0052). The origin comes from the `signUpOrigin`
 * of the OAuth client the sign-up came through, never from the request.
 */

/** Origin of a sign-up outside an OAuth request. */
const SOKOSUMI_ORIGIN = "sokosumi";
/** Origin of a sign-up through a client without a (non-blank) `signUpOrigin`. */
const UNKNOWN_ORIGIN = "unknown";

async function originOf(clientId: string): Promise<string> {
  const client = await prisma.oauthClient.findUnique({
    where: { clientId },
    select: { signUpOrigin: true },
  });
  return client?.signUpOrigin || UNKNOWN_ORIGIN;
}

async function writeSignUpContext(userId: string): Promise<void> {
  const authorizeQuery = await readOAuthAuthorizeQuery();
  const clientId = authorizeQuery?.get("client_id") ?? null;
  await prisma.signUpContext.create({
    data: {
      userId,
      origin: clientId ? await originOf(clientId) : SOKOSUMI_ORIGIN,
      entries: parseSignUpContextEntries(
        authorizeQuery?.get("signup_context") ?? null,
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
