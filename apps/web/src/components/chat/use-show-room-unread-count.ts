"use client";

import { useSession } from "@/lib/auth/auth.client";

/**
 * Whether this reader opted in to a numeric Room unread on sidebar rows.
 *
 * Read from the Better Auth session rather than fetched. The preference is a
 * Better Auth additional field, so it already rides the session every signed-in
 * surface holds, and a sidebar row costs no request of its own. Writing it
 * through `authClient.updateUser` refreshes that session, which is what lets
 * the sidebar follow the switch with no page reload.
 *
 * A session that has not loaded yet reads as off, so the sidebar never flashes
 * a count the reader did not ask for.
 */
export function useShowRoomUnreadCount(): boolean {
  const { data } = useSession();
  return data?.user.showRoomUnreadCount === true;
}
