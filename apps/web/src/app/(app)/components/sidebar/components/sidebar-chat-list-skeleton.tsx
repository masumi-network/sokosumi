import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Placeholder rooms for `OrganizationChatList`, built from the same sidebar
 * primitives the real list uses so the rail's `group-data-[collapsible=icon]`
 * rules apply to it for free.
 *
 * Both states are answered, because the rail is not a narrower version of the
 * panel: it drops the section header outright and keeps only each row's
 * leading mark, centred in the same 32px box every rail item is. A full-width
 * bar in a 56px rail is the shape nothing on this sidebar has.
 */

/**
 * Ragged name lengths, so the panel reads as a list of rooms rather than a
 * stack of identical bars. Doubles as the key: the widths are distinct.
 */
const ROOM_NAME_WIDTHS = ["w-28", "w-20", "w-32", "w-24", "w-16"] as const;

export function SidebarChatListSkeleton() {
  return (
    <SidebarGroup className="w-full" aria-hidden>
      <SidebarGroupContent className="space-y-2">
        {/* `ChatSidebarSectionHeader`'s box: the rail hides it rather than
            shrinking it, so the collapsed skeleton is rows alone. */}
        <div className="group-data-[collapsible=icon]:hidden flex h-10 items-center gap-1 px-3 md:h-8">
          <Skeleton className="size-4 shrink-0 md:size-3" />
          <Skeleton className="h-3 w-20" />
        </div>
        <SidebarMenu className="gap-0">
          {ROOM_NAME_WIDTHS.map((nameWidth) => (
            <SidebarMenuItem key={nameWidth}>
              {/* `ChatRoomSidebarRow`'s link geometry: a 40px row expanded,
                  the rail's 32px box collapsed. `min-w-10` is what centres
                  that box on the rail — `sidebarMenuButtonVariants` gives it
                  to every real rail item, and without it the group's own
                  `p-2` leaves the mark 4px left of the nav icons above. */}
              <div className="flex min-h-10 w-full items-center gap-2 px-3 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-w-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                {/* The leading mark is a 20px glyph slot expanded and the
                    24px channel tile collapsed, matching `ChannelRoomMark`. */}
                <Skeleton className="size-5 shrink-0 group-data-[collapsible=icon]:size-6" />
                <Skeleton
                  className={cn(
                    "group-data-[collapsible=icon]:hidden h-3",
                    nameWidth,
                  )}
                />
              </div>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
