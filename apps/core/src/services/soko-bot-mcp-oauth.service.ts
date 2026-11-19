import { randomBytes } from "node:crypto";
import {
  auth,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp";
import { z } from "zod";
import { guardedFetch, MCP_TIMEOUT_MS } from "@/clients/mcp.client";
import { getBetterAuthPublicBaseUrl } from "@/config/env";
import prisma from "@/lib/db/prisma";
import {
  openSokoBotSecret,
  sealSokoBotSecret,
} from "@/lib/soko-bot/secret-box";

/**
 * Signing in to an MCP server with OAuth 2.1 (ADR 0074), as the MCP spec's
 * authorization section has a client do it: discovery from the server's
 * protected resource metadata, PKCE (S256), the `resource` parameter and
 * dynamic registration, all through `@ai-sdk/mcp`'s `auth`. Everything the
 * flow keeps (tokens, the registered client, the PKCE verifier, the state)
 * is one encrypted blob on the server's row; nothing reaches the model or
 * the sandbox.
 */

export const MCP_OAUTH_CALLBACK_PATH = "/v1/soko-bots/mcp-oauth/callback";

const storedSchema = z.object({
  tokens: z.custom<OAuthTokens>().optional(),
  client: z.custom<OAuthClientInformation>().optional(),
  dynamicallyRegistered: z.boolean().optional(),
  codeVerifier: z.string().optional(),
  state: z.string().optional(),
});
type Stored = z.infer<typeof storedSchema>;

export class McpSignInError extends Error {}

function callbackUrl(): string {
  return `${getBetterAuthPublicBaseUrl()}${MCP_OAUTH_CALLBACK_PATH}`;
}

async function readStored(serverId: string): Promise<Stored> {
  const row = await prisma.sokoBotMcpServer.findUniqueOrThrow({
    where: { id: serverId },
    select: { credentialCiphertext: true, credentialKeyId: true },
  });
  if (!row.credentialCiphertext || !row.credentialKeyId) return {};
  return storedSchema.parse(
    JSON.parse(
      await openSokoBotSecret({
        ciphertext: row.credentialCiphertext,
        keyId: row.credentialKeyId,
      }),
    ),
  );
}

async function writeStored(serverId: string, change: Partial<Stored>) {
  const next = { ...(await readStored(serverId)), ...change };
  const sealed = await sealSokoBotSecret(JSON.stringify(next));
  await prisma.sokoBotMcpServer.update({
    where: { id: serverId },
    data: {
      credentialCiphertext: sealed.ciphertext,
      credentialKeyId: sealed.keyId,
    },
  });
}

/**
 * The provider `@ai-sdk/mcp` asks for tokens and hands them back to. The
 * state names the server, so the callback finds its row; the random half is
 * what proves the round trip is the one this server started.
 */
export class StoredMcpOAuthProvider implements OAuthClientProvider {
  authorizationUrl: URL | null = null;

  constructor(private readonly serverId: string) {}

  get redirectUrl(): string {
    return callbackUrl();
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "Sokosumi",
      redirect_uris: [callbackUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async tokens() {
    return (await readStored(this.serverId)).tokens;
  }

  async saveTokens(tokens: OAuthTokens) {
    await writeStored(this.serverId, { tokens });
  }

  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }

  async saveCodeVerifier(codeVerifier: string) {
    await writeStored(this.serverId, { codeVerifier });
  }

  async codeVerifier() {
    const { codeVerifier } = await readStored(this.serverId);
    if (!codeVerifier) throw new McpSignInError("No sign-in is under way");
    return codeVerifier;
  }

  async clientInformation() {
    return (await readStored(this.serverId)).client;
  }

  async saveClientInformation(client: OAuthClientInformation) {
    await writeStored(this.serverId, { client, dynamicallyRegistered: true });
  }

  async isClientInformationDynamicallyRegistered() {
    return (await readStored(this.serverId)).dynamicallyRegistered === true;
  }

  state() {
    return `${this.serverId}.${randomBytes(24).toString("base64url")}`;
  }

  async saveState(state: string) {
    await writeStored(this.serverId, { state });
  }

  async storedState() {
    return (await readStored(this.serverId)).state;
  }

  validateAuthorizationServerURL(_server: string | URL, issuer: string | URL) {
    if (new URL(issuer).protocol !== "https:")
      throw new McpSignInError("The server's sign-in page is not https");
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    const cleared: Partial<Stored> =
      scope === "all"
        ? {
            tokens: undefined,
            client: undefined,
            dynamicallyRegistered: undefined,
            codeVerifier: undefined,
          }
        : scope === "client"
          ? { client: undefined, dynamicallyRegistered: undefined }
          : scope === "tokens"
            ? { tokens: undefined }
            : { codeVerifier: undefined };
    await writeStored(this.serverId, cleared);
  }
}

type Fetch = typeof globalThis.fetch;

function authFetch(url: string, fetch?: Fetch): Fetch {
  return fetch ?? guardedFetch({ url }, AbortSignal.timeout(MCP_TIMEOUT_MS));
}

/**
 * Starts signing in to a server: discovery and registration run now, and
 * the owner's browser goes to the address this returns. Null when the server
 * needs no sign-in after all.
 */
export async function startMcpSignIn(
  server: { id: string; url: string },
  fetch?: Fetch,
): Promise<string | null> {
  const provider = new StoredMcpOAuthProvider(server.id);
  try {
    const result = await auth(provider, {
      serverUrl: server.url,
      fetchFn: authFetch(server.url, fetch),
    });
    return result === "REDIRECT"
      ? (provider.authorizationUrl?.href ?? null)
      : null;
  } catch (error) {
    if (error instanceof McpSignInError) throw error;
    // The cause can quote the server's reply; the owner gets the plain fact.
    throw new McpSignInError(
      "The server did not offer a sign-in Sokosumi can use. Check the address, or connect it with an API key.",
    );
  }
}

/** The server a callback's state names, before anything is checked. */
export function serverIdFromState(state: string): string | null {
  const [serverId] = state.split(".");
  return z.uuid().safeParse(serverId).success ? (serverId ?? null) : null;
}

/** Finishes the round trip: checks the state, then trades the code for tokens. */
export async function finishMcpSignIn(
  server: { id: string; url: string },
  callback: { code: string; state: string; issuer?: string },
  fetch?: Fetch,
): Promise<void> {
  const provider = new StoredMcpOAuthProvider(server.id);
  if ((await provider.storedState()) !== callback.state)
    throw new McpSignInError("This sign-in link is out of date; sign in again");
  const result = await auth(provider, {
    serverUrl: server.url,
    authorizationCode: callback.code,
    callbackState: callback.state,
    callbackIssuer: callback.issuer,
    fetchFn: authFetch(server.url, fetch),
  }).catch(() => {
    throw new McpSignInError("The server refused the sign-in; try again");
  });
  if (result !== "AUTHORIZED")
    throw new McpSignInError("The server refused the sign-in; try again");
  await writeStored(server.id, { codeVerifier: undefined, state: undefined });
}
