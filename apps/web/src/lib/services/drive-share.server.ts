import "server-only";

import {
  getShareDriveByToken,
  getShareDriveByTokenDownload,
  type PublicDriveShare,
  postShareDriveByTokenUnlock,
} from "@sokosumi/core-client";
import { createClient } from "@sokosumi/core-client/client";
import { cache } from "react";

import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

/** The cookie a browser keeps once it gave a link's password. */
export const DRIVE_SHARE_UNLOCK_COOKIE = "file_share_unlock";
/** Core's header for that proof. */
const UNLOCK_HEADER = "x-drive-share-unlock";

/** A public read: no viewer cookies, the link is the whole credential. */
function publicClient(proof: string | undefined) {
  return createClient({
    baseUrl: getServerCoreApiBaseUrl(),
    headers: proof ? { [UNLOCK_HEADER]: proof } : {},
  });
}

/** The shared file or folder, or null when the link does not resolve. */
export const readDriveShare = cache(
  async (
    token: string,
    proof: string | undefined,
  ): Promise<PublicDriveShare | null> => {
    const { data, response } = await getShareDriveByToken({
      client: publicClient(proof),
      path: { token },
    });
    if (response?.status === 404 || !data) return null;
    return data.data;
  },
);

export type DriveShareUnlockResult =
  | { ok: true; proof: string }
  | { ok: false; reason: "wrong" | "locked" | "missing" };

export async function unlockDriveShare(
  token: string,
  password: string,
): Promise<DriveShareUnlockResult> {
  const { data, response } = await postShareDriveByTokenUnlock({
    client: publicClient(undefined),
    path: { token },
    body: { password },
  });
  if (data) return { ok: true, proof: data.data.proof };
  return {
    ok: false,
    reason:
      response?.status === 429
        ? "locked"
        : response?.status === 401
          ? "wrong"
          : "missing",
  };
}

export async function driveShareDownloadUrl(
  token: string,
  proof: string | undefined,
  path: string | undefined,
): Promise<string | null> {
  const { data } = await getShareDriveByTokenDownload({
    client: publicClient(proof),
    path: { token },
    query: path ? { path } : {},
  });
  return data?.data.url ?? null;
}
