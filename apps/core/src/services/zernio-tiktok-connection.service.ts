import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { ZernioApiError, zernioRequest } from "@/clients/zernio.client";
import { conflict } from "@/helpers/error";

const objectId = z.string().regex(/^[0-9a-f]{24}$/i);
const profile = z.object({ _id: objectId });
const account = z.object({
  _id: objectId,
  platform: z.literal("tiktok"),
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
 * `returnTo` gives the origin TikTok sends the person back to, at
 * `/zernio/callback`, and may name a Project (CMO's callbacks do).
 */
export async function createZernioTikTokIntent(returnTo: string) {
  const attempt = randomUUID();
  const result = await zernioRequest("/profiles", {
    method: "POST",
    body: { name: `Sokosumi TikTok ${attempt}` },
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
  callback.searchParams.set("connection", connectionId);
  callback.searchParams.set("proof", proof);
  return {
    connectionId,
    profileId,
    callback,
    authConfigId: zernioProofDigest(proof),
  };
}

export async function getZernioTikTokAuthUrl(profileId: string, callback: URL) {
  const params = new URLSearchParams({
    profileId,
    redirect_url: callback.href,
  });
  const result = await zernioRequest(`/connect/tiktok?${params}`);
  return z.object({ authUrl: z.url({ protocol: /^https$/ }) }).parse(result)
    .authUrl;
}

async function profileTikTokAccounts(profileId: string, signal?: AbortSignal) {
  const params = new URLSearchParams({
    profileId,
    platform: "tiktok",
    includeOverLimit: "true",
  });
  const { accounts } = z
    .object({ accounts: z.array(account) })
    .parse(await zernioRequest(`/accounts?${params}`, { signal }));
  if (
    accounts.length > 1 ||
    accounts.some((entry) => entry.profileId !== profileId)
  ) {
    throw conflict("Unexpected accounts on the TikTok connection profile");
  }
  return accounts;
}

export async function getZernioTikTokIdentity(profileId: string) {
  const [entry] = await profileTikTokAccounts(profileId);
  if (!entry?.isActive || entry.needsReconnection || !entry.platformUserId) {
    throw conflict("TikTok connection is not active");
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
export async function deleteZernioTikTokProfile(
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
    const entries = await profileTikTokAccounts(profileId, signal);
    for (const entry of entries) {
      await deleteZernioResource(`/accounts/${entry._id}`, signal);
    }
  }
  await deleteZernioResource(`/profiles/${objectId.parse(profileId)}`, signal);
}
