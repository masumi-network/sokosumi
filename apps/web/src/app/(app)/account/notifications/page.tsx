import { getSessionOrRedirect } from "@/lib/auth/auth.server";

import { NotificationPreferences } from "../components/notification-preferences";

/**
 * Notifications on a page of their own (Account → Notifications).
 *
 * The matrix was the tallest thing the account page held, and the one a
 * reader comes back to. On its own route it opens where it is linked to rather
 * than halfway down a page of unrelated forms, and the primer that offers push
 * can point at it by name.
 */
export default async function AccountNotificationsPage() {
  const session = await getSessionOrRedirect();

  return (
    <div className="mx-auto w-full max-w-4xl px-4">
      <NotificationPreferences
        notificationsOptIn={session.user.notificationsOptIn ?? true}
        marketingOptIn={session.user.marketingOptIn ?? false}
      />
    </div>
  );
}
