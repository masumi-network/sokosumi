"use client";

import { useTranslations } from "next-intl";
import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

import {
  listCoworkerGrantsAction,
  resolveCoworkerGrantAction,
} from "@/lib/actions/coworker-grant/action";
import { useSession } from "@/lib/auth/auth.client";
import type {
  CoworkerGrant,
  NotificationItem,
} from "@/lib/clients/generated/core";

interface GrantResolutionState {
  grantsById: Record<string, CoworkerGrant> | null;
  busyGrantId: string | null;
}

// Module-level store shared by every surface rendering grant decisions (the
// notifications page and the header dropdown can be mounted at once) —
// resolving a request on one must immediately update the other, and the
// busy lock must span surfaces so the same grant can't be double-resolved.
let grantState: GrantResolutionState = { grantsById: null, busyGrantId: null };
let grantsFetchInFlight = false;
let grantsLastFetchedAt = 0;
// Whose grants the store holds — a client-side logout/login on the same tab
// must not answer the next user's rows with the previous user's grants.
let grantStateForUserId: string | null = null;
// Floor between refetches when an on-screen request references a grant the
// store doesn't know (new request arrived live, or the row was deleted —
// the latter must not turn into a fetch loop).
const GRANTS_REFETCH_MIN_INTERVAL_MS = 15_000;
const grantStateListeners = new Set<() => void>();

function setGrantState(patch: Partial<GrantResolutionState>) {
  grantState = { ...grantState, ...patch };
  for (const listener of grantStateListeners) {
    listener();
  }
}

function subscribeGrantState(listener: () => void) {
  grantStateListeners.add(listener);
  return () => {
    grantStateListeners.delete(listener);
  };
}

const SERVER_GRANT_STATE: GrantResolutionState = {
  grantsById: null,
  busyGrantId: null,
};

/**
 * Inline resolution of COWORKER_ACCESS notifications, shared by the
 * notifications page and the header dropdown. Grant rows (keyed by grant id
 * = the notification's referenceId) load lazily once such a notification is
 * on screen; `grantsById` stays null until then.
 */
export function useCoworkerGrantResolution({
  notifications,
  markRead,
  onMarkedRead,
}: {
  notifications: NotificationItem[];
  markRead: (notificationId: string) => Promise<void>;
  onMarkedRead?: (notificationId: string) => void;
}) {
  const tGrants = useTranslations("App.Connections.CoworkerAccess");
  const { data: session } = useSession();
  const sessionUserId = session?.user.id ?? null;
  const { grantsById, busyGrantId } = useSyncExternalStore(
    subscribeGrantState,
    () => grantState,
    () => SERVER_GRANT_STATE,
  );

  useEffect(() => {
    if (
      sessionUserId &&
      grantStateForUserId &&
      grantStateForUserId !== sessionUserId
    ) {
      // Session switched on this tab: drop the previous user's grants and
      // refetch immediately (setGrantState updates the module state
      // synchronously, so the reads below see the reset).
      grantsLastFetchedAt = 0;
      setGrantState({ grantsById: null, busyGrantId: null });
    }
    if (sessionUserId) {
      grantStateForUserId = sessionUserId;
    }
    if (grantsFetchInFlight) return;
    const accessRows = notifications.filter(
      (n) => n.kind === "COWORKER_ACCESS",
    );
    if (accessRows.length === 0) return;
    const loaded = grantState.grantsById;
    const needsFetch =
      loaded === null || accessRows.some((n) => !loaded[n.referenceId]);
    if (!needsFetch) return;
    if (
      loaded !== null &&
      Date.now() - grantsLastFetchedAt < GRANTS_REFETCH_MIN_INTERVAL_MS
    ) {
      return;
    }
    grantsFetchInFlight = true;
    void (async () => {
      try {
        const result = await listCoworkerGrantsAction();
        if (!result.ok) return; // rows fall back to deep-linking to the portal
        grantsLastFetchedAt = Date.now();
        setGrantState({
          grantsById: Object.fromEntries(
            result.data.map((grant) => [grant.id, grant]),
          ),
        });
      } finally {
        grantsFetchInFlight = false;
      }
    })();
  }, [notifications, sessionUserId]);

  const resolveGrant = async (
    notification: NotificationItem,
    status: "GRANTED" | "DENIED",
  ) => {
    if (grantState.busyGrantId !== null) return;
    setGrantState({ busyGrantId: notification.referenceId });
    const result = await resolveCoworkerGrantAction(
      notification.referenceId,
      status,
    );
    if (!result.ok) {
      setGrantState({ busyGrantId: null });
      toast.error(result.error.message ?? tGrants("resolveFailed"));
      return;
    }
    setGrantState({
      busyGrantId: null,
      grantsById: {
        ...(grantState.grantsById ?? {}),
        [result.data.id]: result.data,
      },
    });
    toast.success(
      status === "GRANTED" ? tGrants("approvedToast") : tGrants("updatedToast"),
    );
    if (!notification.isRead) {
      try {
        await markRead(notification.id);
        onMarkedRead?.(notification.id);
      } catch {
        // read-state failure is cosmetic here; the grant is resolved.
      }
    }
  };

  return { grantsById, busyGrantId, resolveGrant };
}
