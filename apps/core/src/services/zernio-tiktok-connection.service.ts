import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ZernioApiError, zernioRequest } from "@/clients/zernio.client";
import { conflict } from "@/helpers/error";

const objectId = z.string().regex(/^[0-9a-f]{24}$/i);
const profile = z.object({ _id: objectId });
const account = z.object({
  _id: objectId,
  platform: z.string(),
  profileId: z.union([objectId, profile.transform((value) => value._id)]),
  isActive: z.boolean(),
  needsReconnection: z.boolean().optional(),
  platformUserId: z.string().min(1).optional(),
  username: z.string().nullish(),
  displayName: z.string().nullish(),
  profilePicture: z.string().nullish(),
});

export function zernioProofDigest(proof: string): string {
  return createHash("sha256").update(proof).digest("hex");
}

/** What CMO's return address names, carried back beside the proof. */
const RETURN_PARAMS = ["project", "from"] as const;

/**
 * `returnTo` gives the origin the network sends the person back to, at
 * `/zernio/callback`, and may name a Project (CMO's callbacks do).
 */
export async function createZernioIntent(
  returnTo: string,
  network: "TikTok" | "LinkedIn",
) {
  const attempt = randomUUID();
  const result = await zernioRequest("/profiles", {
    method: "POST",
    body: { name: `Sokosumi ${network} ${attempt}` },
    idempotencyKey: attempt,
  });
  const profileId = z.object({ profile }).parse(result).profile._id;
  const proof = randomBytes(32).toString("base64url");
  const connectionId = `zernio:${profileId}`;
  const callback = new URL("/zernio/callback", returnTo);
  for (const name of RETURN_PARAMS) {
    const value = new URL(returnTo).searchParams.get(name);
    if (value) callback.searchParams.set(name, value);
  }
  // Keeps LinkedIn's token and Page list out of the address it returns to.
  if (network === "LinkedIn") {
    callback.searchParams.set("pendingDataOnly", "true");
  }
  callback.searchParams.set("connection", connectionId);
  callback.searchParams.set("proof", proof);
  return {
    connectionId,
    profileId,
    callback,
    authConfigId: zernioProofDigest(proof),
  };
}

export async function getZernioAuthUrl(
  platform: "tiktok" | "linkedin",
  profileId: string,
  callback: URL,
) {
  const params = new URLSearchParams({
    profileId,
    redirect_url: callback.href,
    // LinkedIn comes back with the Pages to pick from instead of Zernio's picker.
    ...(platform === "linkedin" && {
      headless: "true",
      scopes: "posting,analytics,comments",
    }),
  });
  const result = await zernioRequest(`/connect/${platform}?${params}`);
  return z.object({ authUrl: z.url({ protocol: /^https$/ }) }).parse(result)
    .authUrl;
}

/** Every account on one of our profiles; each profile holds one connection. */
async function zernioProfileAccounts(profileId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ profileId, includeOverLimit: "true" });
  const { accounts } = z
    .object({ accounts: z.array(account) })
    .parse(await zernioRequest(`/accounts?${params}`, { signal }));
  if (
    accounts.length > 1 ||
    accounts.some((entry) => entry.profileId !== profileId)
  ) {
    throw conflict("Unexpected accounts on the connection profile");
  }
  return accounts;
}

/**
 * The one account a sign-in left on its profile: a TikTok creator, or a
 * LinkedIn member whose sign-in reached no Page, so Zernio kept it at once.
 */
export async function getZernioProfileIdentity(
  profileId: string,
  platform: "tiktok" | "linkedin",
) {
  const [entry] = await zernioProfileAccounts(profileId);
  if (
    entry?.platform !== platform ||
    !entry.isActive ||
    entry.needsReconnection ||
    !entry.platformUserId
  ) {
    throw conflict(
      `${platform === "tiktok" ? "TikTok" : "LinkedIn"} connection is not active`,
    );
  }
  return {
    connectedAccountId: `zernio:${entry._id}`,
    identity: {
      id: entry.platformUserId,
      handle: entry.username ?? null,
      displayName: entry.displayName ?? null,
      avatarUrl: entry.profilePicture ?? null,
      subscriptionType: null,
    },
  };
}

async function deleteZernioResource(path: string, signal?: AbortSignal) {
  try {
    await zernioRequest(path, { method: "DELETE", signal });
  } catch (error) {
    if (!(error instanceof ZernioApiError && error.status === 404)) throw error;
  }
}

/** Zernio requires active accounts to be disconnected before deleting their profile. */
export async function deleteZernioProfile(
  profileId: string,
  accountId?: string,
  signal?: AbortSignal,
) {
  if (accountId) {
    await deleteZernioResource(
      `/accounts/${objectId.parse(accountId)}`,
      signal,
    );
  } else {
    const entries = await zernioProfileAccounts(profileId, signal);
    for (const entry of entries) {
      await deleteZernioResource(`/accounts/${entry._id}`, signal);
    }
  }
  await deleteZernioResource(`/profiles/${objectId.parse(profileId)}`, signal);
}
