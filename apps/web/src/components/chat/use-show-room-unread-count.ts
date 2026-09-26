"use client";

import { useSession } from "@/lib/auth/auth.client";

/**
 * Whether sidebar rows show this reader a numeric Room unread.
 *
 * On unless they switched it off (ADR-0038). The preference is stored as
 * `hideRoomUnreadCount`, so its false, which every reader starts with, means
 * shown. A session minted before the field existed carries no value for it,
 * and that reader never chose either, so it reads as shown too.
 *
 * Read from the Better Auth session rather than fetched. The preference is a
 * Better Auth additional field, so it already rides the session every signed-in
 * surface holds, and a sidebar row costs no request of its own. Writing it
 * through `authClient.updateUser` refreshes that session, which is what lets
 * the sidebar follow the switch with no page reload.
 *
 * A session that has not loaded yet reads as off. Only the session knows
 * whether this reader switched the count off, so the sidebar waits for it
 * rather than flash a count at someone who said no.
 */
export function useShowRoomUnreadCount(): boolean {
  const { data } = useSession();
  return data != null && data.user.hideRoomUnreadCount !== true;
}
