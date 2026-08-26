/**
 * Prisma projection for the user preference flags, shared by the read and the
 * write route so a new flag is one edit. Mirrors `userPreferencesResponseSchema`.
 */
export const USER_PREFERENCES_SELECT = {
  marketingOptIn: true,
  notificationsOptIn: true,
  pushOptIn: true,
} as const;
