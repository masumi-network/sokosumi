import {
  resolveNotificationMatrix,
  type StoredNotificationPreference,
} from "@/helpers/notification-delivery";
import { userPreferencesResponseSchema } from "@/schemas/user.schema";

/**
 * Prisma projection for one user's preferences, shared by the read and the
 * write route so a new flag is one edit.
 *
 * It carries the stored preference rows rather than the response's cells:
 * `toUserPreferencesResponse` resolves those into the matrix a client reads.
 */
export const USER_PREFERENCES_SELECT = {
  marketingOptIn: true,
  notificationsOptIn: true,
  pushOptIn: true,
  hideRoomUnreadCount: true,
  notificationPreferences: {
    select: { category: true, channel: true, enabled: true },
  },
} as const;

interface UserPreferencesRow {
  marketingOptIn: boolean;
  notificationsOptIn: boolean;
  pushOptIn: boolean;
  hideRoomUnreadCount: boolean;
  notificationPreferences: StoredNotificationPreference[];
}

/**
 * The response body for one user's preferences.
 *
 * The stored rows are only the choices the reader made, so the matrix is
 * resolved here: a client renders every cell without knowing the defaults.
 */
export function toUserPreferencesResponse(user: UserPreferencesRow) {
  return userPreferencesResponseSchema.parse({
    marketingOptIn: user.marketingOptIn,
    notificationsOptIn: user.notificationsOptIn,
    pushOptIn: user.pushOptIn,
    // Stored as "hide" and answered as "show" (ADR-0038). The column's false
    // is what starts every reader on the count, with no backfill. The wire
    // field keeps its name, so no client, the Apple app included, has to move.
    showRoomUnreadCount: !user.hideRoomUnreadCount,
    notificationPreferences: resolveNotificationMatrix(
      user.notificationPreferences,
    ),
  });
}
