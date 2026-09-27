"use client";

import { makeCurrentUserNotificationsChannelName } from "./current-notifications-channel.client";

function storageKey(userId: string): string {
  return `sokosumi.push.consent:${makeCurrentUserNotificationsChannelName(userId)}`;
}

/** The consent outlives SDK device replacements and local teardown. */
export function readPushConsentId(userId: string): string | undefined {
  return localStorage.getItem(storageKey(userId)) || undefined;
}

/** A failed write must stop activation before it replaces the old device. */
export function rememberPushConsentId(userId: string, consentId: string): void {
  localStorage.setItem(storageKey(userId), consentId);
}
