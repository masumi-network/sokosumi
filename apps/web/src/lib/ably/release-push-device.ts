"use client";

import {
  hasWebPushSubscription,
  isPushSupported,
} from "@/lib/utils/notification-service-worker";

/**
 * Drop this browser's push registration before an explicit sign-out.
 *
 * Web Push needs no session. The push service keeps delivering to the
 * endpoint it holds and the service worker keeps rendering banners, so a
 * browser left signed out would go on showing the previous reader's chat
 * mentions to whoever uses it next. Ably's own device keys in `localStorage`
 * go with the deactivation.
 *
 * Only an explicit sign-out calls this. A session that expires on its own
 * does not, so a reader who comes back finds push still on and never has to
 * turn it on again.
 *
 * Must run before `signOut()`: deactivation mints an Ably token, which needs
 * the session that is about to end.
 */
export async function releasePushDeviceOnSignOut(
  userId: string | undefined,
): Promise<void> {
  // The support check and the subscription read are both local, so a reader
  // who never enabled push pays nothing and never loads the Ably SDK.
  if (!userId || !isPushSupported()) {
    return;
  }

  try {
    if (!(await hasWebPushSubscription())) {
      return;
    }

    const { deactivatePush } = await import("./push-activation.client");
    await deactivatePush(userId);
  } catch (error) {
    // Signing out must not fail because Ably did. The registration is then
    // still live, and the reader can clear it from the settings switch or
    // from the browser's own site data.
    console.error("Failed to release the push device on sign out", error);
  }
}
