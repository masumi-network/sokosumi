/**
 * The fragment the notification primer links to, and the `id` the settings
 * card carries.
 *
 * A leaf module rather than an export from the card. The primer and its test
 * both need this string, and importing it from the card would pull the whole
 * settings tree, the auth client, and the generated Core client behind it.
 */
export const NOTIFICATION_PREFERENCES_ANCHOR = "notification-preferences";

/** Where the primer sends a reader to finish turning push on. */
export const NOTIFICATION_PREFERENCES_HREF = `/account#${NOTIFICATION_PREFERENCES_ANCHOR}`;
