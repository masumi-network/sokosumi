/**
 * The fragment the notification primer links to, and the `id` the settings
 * card carries.
 *
 * A leaf module rather than an export from the card. The primer and its test
 * both need this string, and importing it from the card would pull the whole
 * settings tree, the auth client, and the generated Core client behind it.
 */
export const NOTIFICATION_PREFERENCES_ANCHOR = "notification-preferences";

/**
 * Where the reader turns push on. On a browser that can push, the primer hands
 * them here rather than asking for the permission itself: a bare permission
 * only buys banners while a tab is open, and the reader who clicked "enable
 * notifications" would still hear nothing once they closed the app. The
 * account page runs the whole gesture, permission included.
 */
export const NOTIFICATION_PREFERENCES_HREF = `/account#${NOTIFICATION_PREFERENCES_ANCHOR}`;
