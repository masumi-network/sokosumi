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
 * panel: the section header becomes one 32px square and each row keeps only
 * its leading mark, centred in the same 32px box every rail item is. A
 * full-width bar in a 56px rail is the shape nothing on this sidebar has.
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
        {/* `ChatSidebarSectionHeader`'s box: a titled row expanded, the
            section's 32px icon square on the rail. */}
        <div className="flex h-11 items-center gap-3 px-3 md:h-8 md:gap-1 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <Skeleton className="mx-1.5 size-4 shrink-0 md:mx-0 md:size-3 group-data-[collapsible=icon]:mx-0 group-data-[collapsible=icon]:size-4" />
          <Skeleton className="h-3 w-20 group-data-[collapsible=icon]:hidden" />
        </div>
        <SidebarMenu className="gap-0">
          {ROOM_NAME_WIDTHS.map((nameWidth) => (
            <SidebarMenuItem key={nameWidth}>
              {/* `ChatRoomSidebarRow`'s link geometry: a 44px row below `md`,
                  40px above it, the rail's 32px square collapsed. `mx-auto` is what centres
                  that square on the rail — `sidebarMenuButtonVariants` gives
                  it to every real rail item, and without it the group's own
                  `p-2` leaves the mark 4px left of the nav icons above. */}
              <div className="flex min-h-11 w-full items-center gap-3 px-3 md:min-h-10 md:gap-2 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:min-h-8! group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                {/* The leading mark is a 28px slot below `md`, 20px above, and the
                    24px channel tile collapsed, matching `ChannelRoomMark`. */}
                <Skeleton className="size-7 shrink-0 md:size-5 group-data-[collapsible=icon]:size-6" />
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
