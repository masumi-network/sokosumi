/**
 * Where the notification settings live.
 *
 * A leaf module rather than an export from the page. The primer and its test
 * both need this string, and importing it from the settings tree would pull
 * the auth client and the generated Core client behind it.
 *
 * On a browser that can push, the primer hands the reader here rather than
 * asking for the permission itself: a bare permission only buys banners while
 * a tab is open, and the reader who clicked "enable notifications" would still
 * hear nothing once they closed the app. The settings page runs the whole
 * gesture, permission included.
 */
export const NOTIFICATION_PREFERENCES_HREF = "/account/notifications";
