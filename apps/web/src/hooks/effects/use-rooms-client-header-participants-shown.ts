"use client";

import { useEffect, useState } from "react";

/**
 * Defers `RoomsClient` header participant avatars until after first paint so
 * the room title is not gated on the avatar stack committing in the same LCP
 * frame.
 */
export function useRoomsClientHeaderParticipantsShown(): boolean {
  // Defer participant avatars one frame so the title string is not gated on
  // the avatar stack committing in the same first paint.
  // Approved LCP exception: mount-only Effect keeps title-with-composer paint
  // order; do not replace with render-time/portal-only avatar mounting.
  const [showHeaderParticipants, setShowHeaderParticipants] = useState(false);
  useEffect(() => {
    setShowHeaderParticipants(true);
  }, []);
  return showHeaderParticipants;
}
