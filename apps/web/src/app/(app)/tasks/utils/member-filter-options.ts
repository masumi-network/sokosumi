import type { MemberWithUser } from "@sokosumi/database";

export interface MemberFilterOption {
  id: string;
  name: string;
  image: string | null;
  isMe?: boolean;
}

export interface MemberPreviewItem {
  id: string;
  name: string | null;
  image: string | null;
}

function resolveMemberName(
  ...candidates: Array<string | null | undefined>
): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

export function buildMemberFilterOptions(
  members: MemberWithUser[],
  currentUserId: string,
  meLabel: string,
  currentUserImage: string | null,
): MemberFilterOption[] {
  const uniqueOptions = new Map<string, MemberFilterOption>();

  uniqueOptions.set(currentUserId, {
    id: currentUserId,
    name: meLabel,
    image: currentUserImage,
    isMe: true,
  });

  for (const member of members) {
    if (uniqueOptions.has(member.userId)) {
      continue;
    }

    uniqueOptions.set(member.userId, {
      id: member.userId,
      name: member.user.name || member.user.email || member.userId,
      image: member.user.image,
    });
  }

  return Array.from(uniqueOptions.values());
}

export function buildMemberPreviewItems(
  members: MemberWithUser[],
  currentUser: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null,
): MemberPreviewItem[] {
  const previews = new Map<string, MemberPreviewItem>();

  if (currentUser?.id) {
    previews.set(currentUser.id, {
      id: currentUser.id,
      name: resolveMemberName(
        currentUser.name,
        currentUser.email,
        currentUser.id,
      ),
      image: currentUser.image ?? null,
    });
  }

  for (const member of members) {
    if (previews.has(member.userId)) {
      continue;
    }

    previews.set(member.userId, {
      id: member.userId,
      name: resolveMemberName(
        member.user.name,
        member.user.email,
        member.userId,
      ),
      image: member.user.image,
    });
  }

  return Array.from(previews.values());
}
