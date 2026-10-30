"use client";

import type { ChatRoom } from "@sokosumi/core-client";
import { WorkspaceAvatar } from "@/app/components/user-avatar/workspace-avatar";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { getInitials } from "@/lib/utils/text";

interface RoomWorkspaceTileProps {
  room: ChatRoom;
  workspaceName: string;
  /**
   * Stands in the room menu's column and fades as the menu appears. Otherwise,
   * beside a count or a reorder handle, it stands just left of that column and
   * returns to full colour on hover. Touch has no hover, so it is always in flow.
   */
  takesMenuColumn: boolean;
}

/**
 * A Pinned row's Workspace tile: the face the Workspace switcher draws, with the
 * initial of the name in place of the generic building icon, so two workspaces
 * with no logo do not look the same. Grey and softened at rest, by a filter
 * rather than a color, because a logo's own colors are what would shout. The
 * row's title and accessible name carry the workspace's name.
 */
export function RoomWorkspaceTile({
  room,
  workspaceName,
  takesMenuColumn,
}: RoomWorkspaceTileProps) {
  const { data: session } = useSession();
  if (!session) {
    return null;
  }

  return (
    <span
      aria-hidden
      data-slot="workspace-tile"
      className={cn(
        "pointer-events-none flex shrink-0 items-center justify-center opacity-70 grayscale",
        "motion-safe:transition-[opacity,filter] motion-safe:duration-150",
        takesMenuColumn
          ? [
              "[@media(hover:hover)]:absolute [@media(hover:hover)]:top-1/2 [@media(hover:hover)]:right-0 [@media(hover:hover)]:size-7 [@media(hover:hover)]:-translate-y-1/2",
              "[@media(hover:hover)]:group-hover/room-row:opacity-0 [@media(hover:hover)]:group-focus-within/room-row:opacity-0 group-has-[[data-state=open]]/room-row:opacity-0",
            ]
          : "[@media(hover:hover)]:group-hover/room-row:opacity-100 [@media(hover:hover)]:group-hover/room-row:grayscale-0",
      )}
    >
      <WorkspaceAvatar
        sessionUser={session.user}
        organization={
          room.organizationId === null
            ? null
            : {
                name: workspaceName,
                logo: room.organizationLogo ?? null,
                websiteUrl: room.organizationWebsiteUrl ?? null,
              }
        }
        className="size-3.5"
        logoSize={14}
        logoFallback={
          <span className="text-2xs leading-none font-medium">
            {getInitials(workspaceName).slice(0, 1)}
          </span>
        }
        decorative
      />
    </span>
  );
}
