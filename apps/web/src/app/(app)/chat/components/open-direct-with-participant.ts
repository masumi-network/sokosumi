import {
  createDirectRoomAction,
  ensureCoworkerDirectRoomAction,
  ensureSokoBotDirectRoomAction,
} from "@/app/chat/actions";
import { notifyOrganizationChatRoomsChanged } from "@/components/chat/organization-chat-events";

import type { ChatParticipantHoverProfile } from "./room-helpers";

export function participantDirectKey(
  profile: ChatParticipantHoverProfile,
): `${"human" | "coworker" | "sokoBot"}:${string}` {
  return `${profile.kind}:${profile.id}`;
}

/** Hover Message on humans: External roster always; other rooms need org seat. */
export function canOpenHumanDirectFromSelectedRoom(options: {
  kind: string | undefined;
  discoverability: string | null | undefined;
  myAccess: string | undefined;
  hasActiveOrganization: boolean;
}): boolean {
  const isGuest = options.myAccess === "guest";
  const isExternalChannel =
    options.kind === "channel" && options.discoverability === "external";
  return isExternalChannel || (options.hasActiveOrganization && !isGuest);
}

export function canShowOpenDirect(options: {
  profile: ChatParticipantHoverProfile;
  currentUserId: string | undefined;
  canOpenHumanDirect: boolean;
  onOpenDirect?: (profile: ChatParticipantHoverProfile) => void;
}): boolean {
  const { profile, currentUserId, canOpenHumanDirect, onOpenDirect } = options;
  if (!onOpenDirect) return false;
  if (profile.kind === "human") {
    if (!canOpenHumanDirect) return false;
    if (currentUserId && profile.id === currentUserId) return false;
  }
  return true;
}

export async function openDirectWithParticipant(options: {
  profile: ChatParticipantHoverProfile;
  selectedRoomId: string | null | undefined;
  router: { push: (href: string) => void };
  onError: (message: string) => void;
}): Promise<{ ok: true; roomId: string } | { ok: false }> {
  const { profile, selectedRoomId, router, onError } = options;
  const result =
    profile.kind === "coworker"
      ? await ensureCoworkerDirectRoomAction(profile.id)
      : profile.kind === "sokoBot"
        ? await ensureSokoBotDirectRoomAction(profile.id)
        : await createDirectRoomAction({ memberUserId: profile.id });

  if (!result.ok) {
    onError(result.error.message ?? "Could not start direct message.");
    return { ok: false };
  }
  if (!result.value) {
    onError("Could not start direct message.");
    return { ok: false };
  }

  notifyOrganizationChatRoomsChanged(result.value);
  if (result.value.id !== selectedRoomId) {
    router.push(`/chat/rooms/${result.value.id}`);
  }
  return { ok: true, roomId: result.value.id };
}
