export type ChatRootMobileSurface = "landing" | "list";

/**
 * Mobile surface at chat root. Landing only when there are no
 * membership-visible rooms and no archived rooms (archived-only stays list).
 */
export function resolveChatRootMobileSurface(args: {
  membershipVisibleCount: number;
  archivedCount: number;
}): ChatRootMobileSurface {
  if (args.membershipVisibleCount > 0 || args.archivedCount > 0) {
    return "list";
  }
  return "landing";
}
