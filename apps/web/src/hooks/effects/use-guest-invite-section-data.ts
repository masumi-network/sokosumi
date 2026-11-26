"use client";

import type {
  ChatRoomGuestInviteLink,
  ChatRoomInvitation,
} from "@sokosumi/core-client";
import { useCallback, useEffect, useState } from "react";
import {
  listRoomGuestInviteLinksAction,
  listRoomInvitationsAction,
} from "@/app/chat/actions";

/**
 * Loads pending guest email invitations and non-revoked invite links for
 * `GuestInviteSection` on mount (parent remounts on dialog open) and exposes
 * `loadInvitations` for explicit retry.
 */
export function useGuestInviteSectionData(roomId: string) {
  const [invitations, setInvitations] = useState<ChatRoomInvitation[]>([]);
  const [inviteLinks, setInviteLinks] = useState<ChatRoomGuestInviteLink[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const loadInvitations = useCallback(async () => {
    setIsLoading(true);
    setLoadFailed(false);
    const [invitationsResult, linksResult] = await Promise.all([
      listRoomInvitationsAction(roomId),
      listRoomGuestInviteLinksAction(roomId),
    ]);
    setIsLoading(false);
    if (!invitationsResult.ok || !linksResult.ok) {
      setLoadFailed(true);
      setInvitations([]);
      setInviteLinks([]);
      return;
    }
    setInvitations(
      invitationsResult.value.filter((inv) => inv.status === "pending"),
    );
    // Show non-revoked links (expired/depleted still useful for audit until host revokes).
    setInviteLinks(linksResult.value.filter((link) => !link.revokedAt));
  }, [roomId]);

  // Mount-only fetch; parent remounts on dialog open so reopen is fresh.
  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  return {
    invitations,
    setInvitations,
    inviteLinks,
    setInviteLinks,
    loadFailed,
    isLoading,
    loadInvitations,
  };
}
