import { PushDevices } from "@/app/account/components/push-devices";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { ChatDisplayPreferences } from "../components/chat-display-preferences";
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
        marketingOptIn={session.user.marketingOptIn ?? false}
      >
        <div className="space-y-6">
          <PushDevices userId={session.user.id} />
          <ChatDisplayPreferences
            showRoomUnreadCount={session.user.hideRoomUnreadCount !== true}
          />
        </div>
      </NotificationPreferences>
    </div>
  );
}
