"use client";

import { releasePushDeviceOnSignOut } from "@/lib/ably/release-push-device.client";

import { signOut } from "./auth.client";

/**
 * Sign out, and take this browser's push registration with it.
 *
 * The order is the whole point. Deactivation mints an Ably token, so it needs
 * the session that is about to end. Left to each caller, that contract lived
 * in a comment copied at every sign-out button, and a fourth button would have
 * silently kept delivering the previous reader's chat mentions to whoever used
 * the browser next.
 *
 * Only an explicit sign-out goes through here. A session that expires on its
 * own calls nothing, so a reader who comes back finds push still on and never
 * has to turn it on again.
 */
export function signOutWithPushRelease(
  userId: string | undefined,
  options?: Parameters<typeof signOut>[0],
): ReturnType<typeof signOut> {
  return releasePushDeviceOnSignOut(userId).then(() => signOut(options));
}
