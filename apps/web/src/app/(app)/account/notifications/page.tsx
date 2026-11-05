import { PushDevices } from "@/app/account/components/push-devices";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { getSessionOrRedirect } from "@/lib/auth/auth.server";
import { cn } from "@/lib/utils";
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
    <div className={cn(HOLDER_CLASS, "w-full p-3")}>
      <NotificationPreferences
        marketingOptIn={session.user.marketingOptIn ?? false}
        pushDevices={<PushDevices userId={session.user.id} />}
      >
        <ChatDisplayPreferences
          showRoomUnreadCount={session.user.hideRoomUnreadCount !== true}
          tagDirectMessages={session.user.tagDirectMessages === true}
        />
      </NotificationPreferences>
    </div>
  );
}
