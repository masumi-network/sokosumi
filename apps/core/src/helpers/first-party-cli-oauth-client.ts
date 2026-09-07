import { buildFirstPartyCliOAuthClientWrite } from "@sokosumi/utils";

interface FirstPartyCliOAuthClientStore {
  oauthClient: {
    upsert: (args: {
      where: { clientId: string };
      create: ReturnType<typeof buildFirstPartyCliOAuthClientWrite>;
      update: Omit<
        ReturnType<typeof buildFirstPartyCliOAuthClientWrite>,
        "clientId"
      >;
    }) => Promise<{ clientId: string }>;
  };
}

/**
 * Seeds or repairs the platform-owned Sokosumi CLI OAuth client.
 *
 * Better Auth has no `oauthProvider({ clients })` seed list.
 * `adminCreateOAuthClient` needs a session, attaches that user as `userId`,
 * and issues a random `client_id`. This upsert keeps a stable public
 * `sokosumi_cli` row, native + PKCE, `userId` null.
 */
export async function ensureFirstPartyCliOAuthClient(
  db: FirstPartyCliOAuthClientStore,
) {
  const write = buildFirstPartyCliOAuthClientWrite();
  const { clientId, ...update } = write;
  return db.oauthClient.upsert({
    where: { clientId },
    create: write,
    update,
  });
}
