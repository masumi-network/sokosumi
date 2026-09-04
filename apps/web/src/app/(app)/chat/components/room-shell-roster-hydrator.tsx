"use client";

import { useEffect, useRef } from "react";

import type { RoomShellRosterPage } from "@/app/chat/load-room-shell-roster";

interface RoomShellRosterHydratorProps {
  promise: Promise<RoomShellRosterPage>;
  onResolved: (page: RoomShellRosterPage) => void;
}

/**
 * Resolves deferred org members + coworkers into the parent RoomsClient.
 * Parent (header + composer) stays mounted; roster-dependent UI updates later.
 */
export function RoomShellRosterHydrator({
  promise,
  onResolved,
}: RoomShellRosterHydratorProps) {
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  const deliveredPromiseRef = useRef<Promise<RoomShellRosterPage> | null>(null);

  useEffect(() => {
    let cancelled = false;

    void promise.then(
      (page) => {
        if (cancelled) {
          return;
        }
        if (deliveredPromiseRef.current === promise) {
          return;
        }
        deliveredPromiseRef.current = promise;
        onResolvedRef.current(page);
      },
      () => {
        // Unexpected reject (members soft-fail inside loader; coworkers may
        // still reject). Never leave parent pending forever.
        if (cancelled) {
          return;
        }
        if (deliveredPromiseRef.current === promise) {
          return;
        }
        deliveredPromiseRef.current = promise;
        onResolvedRef.current({
          organizationMembers: [],
          membersLoadFailed: true,
          coworkers: [],
          orchestrators: [],
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [promise]);

  return null;
}
