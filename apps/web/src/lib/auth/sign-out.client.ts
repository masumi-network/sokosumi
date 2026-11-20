"use client";

import { releasePushDeviceOnSignOut } from "@/lib/ably/release-push-device.client";
import { getReturnUrlFromCurrentLocation } from "@/lib/utils/url";

import { signOut } from "./auth.client";

export interface SignOutWithPushReleaseOptions {
  /**
   * How to end the document after sign-out succeeds so no JS cache outlives
   * the user: `"signIn"` (default) loads `/signin?returnUrl=<current location>`,
   * `"reload"` reloads the current URL in place.
   */
  afterSignOut?: "signIn" | "reload";
  fetchOptions?: NonNullable<Parameters<typeof signOut>[0]>["fetchOptions"];
}

/**
 * Sign out, take this browser's push registration with it, and end with a full
 * document load so no in-memory cache outlives the user.
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
  options?: SignOutWithPushReleaseOptions,
): ReturnType<typeof signOut> {
  window.dispatchEvent(new Event("chat-session-ended"));
  const { afterSignOut = "signIn", fetchOptions } = options ?? {};
  const signInUrl = `/signin?returnUrl=${encodeURIComponent(getReturnUrlFromCurrentLocation())}`;

  return releasePushDeviceOnSignOut(userId)
    .then(() => signOut(fetchOptions ? { fetchOptions } : undefined))
    .then((result) => {
      if (!result?.error) {
        if (afterSignOut === "reload") {
          window.location.reload();
        } else {
          window.location.assign(signInUrl);
        }
      }
      return result;
    });
}
