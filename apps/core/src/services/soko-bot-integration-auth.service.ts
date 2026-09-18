import { getEnv } from "@/config/env";
import {
  composioEntityId,
  requireBot,
  SokoBotIntegrationError,
  withComposio,
} from "@/services/soko-bot-integrations.service";

/** Composio's own default host; mirrors the SDK when no override is set. */
const COMPOSIO_DEFAULT_BASE_URL = "https://backend.composio.dev";
const COMPLETE_AUTH_PATH = "/api/v3.1/connected_accounts/complete_auth";
/** A verifier redirect keeps the browser waiting, so fail fast. */
const COMPLETE_AUTH_TIMEOUT_MS = 10_000;

interface CompleteAuthResponse {
  connected_account_id: string;
  toolkit_slug: string;
}

function requireComposioCredentials(): { apiKey: string; baseUrl: string } {
  const env = getEnv();
  if (!env.COMPOSIO_API_KEY) {
    throw new SokoBotIntegrationError(
      "Integrations are not configured on this environment",
      "NOT_CONFIGURED",
    );
  }
  return {
    apiKey: env.COMPOSIO_API_KEY,
    baseUrl: env.COMPOSIO_API_BASE_URL ?? COMPOSIO_DEFAULT_BASE_URL,
  };
}

/**
 * Redeems the single-use `session_uri` Composio hands to our callback verifier.
 *
 * Composio holds every OAuth connection until this call names the user that
 * came back. Passing the signed-in caller's own entity is what stops a shared
 * Connect Link from planting a victim's provider account onto the bot of
 * whoever issued the link: the entity will not match and Composio refuses.
 */
export async function completeSokoBotIntegrationAuth(input: {
  userId: string;
  workspaceId: string;
  sessionUri: string;
}): Promise<{ provider: string; composioAccountId: string }> {
  const { apiKey, baseUrl } = requireComposioCredentials();
  const bot = await requireBot(input.userId, input.workspaceId);
  // Keep any path prefix on the configured base; `new URL` would drop it.
  const endpoint = `${baseUrl.replace(/\/+$/, "")}${COMPLETE_AUTH_PATH}`;
  // A timeout or a transport failure must surface the same way as every other
  // Composio call, not as an unmapped 500.
  const response = await withComposio("complete auth", () =>
    fetch(endpoint, {
      method: "POST",
      headers: { "x-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        session_uri: input.sessionUri,
        user_id: composioEntityId(bot.id),
      }),
      signal: AbortSignal.timeout(COMPLETE_AUTH_TIMEOUT_MS),
    }),
  );
  if (response.status === 400) {
    // Composio reports an identity mismatch here, and moves the connection to
    // FAILED on its side, so the refused authorization is not left usable.
    throw new SokoBotIntegrationError(
      "This authorization was started by a different account",
      "IDENTITY_MISMATCH",
    );
  }
  if (response.status === 404) {
    throw new SokoBotIntegrationError(
      "This authorization link has expired or was already used",
      "NOT_FOUND",
    );
  }
  if (!response.ok) {
    throw new SokoBotIntegrationError(
      `Composio (complete auth): request failed with ${response.status}`,
    );
  }
  const completed = await response
    .json()
    .then((body) => body as Partial<CompleteAuthResponse>)
    .catch(() => ({}) as Partial<CompleteAuthResponse>);
  if (!completed.toolkit_slug || !completed.connected_account_id) {
    throw new SokoBotIntegrationError(
      "Composio (complete auth): response was missing the completed connection",
    );
  }
  return {
    provider: completed.toolkit_slug.toLowerCase(),
    composioAccountId: completed.connected_account_id,
  };
}
