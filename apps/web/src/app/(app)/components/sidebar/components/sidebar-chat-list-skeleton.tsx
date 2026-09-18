import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarRowSlot,
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
        <div className="flex h-11 items-center gap-2 px-2 md:h-8 group-data-[collapsible=icon]:ml-1 group-data-[collapsible=icon]:size-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
          <SidebarRowSlot>
            <Skeleton className="size-4 md:size-3 group-data-[collapsible=icon]:size-4" />
          </SidebarRowSlot>
          <Skeleton className="h-3 w-20 group-data-[collapsible=icon]:hidden" />
        </div>
        <SidebarMenu className="gap-0">
          {ROOM_NAME_WIDTHS.map((nameWidth) => (
            <SidebarMenuItem key={nameWidth}>
              {/* `sidebarMenuButtonVariants`' geometry, by hand: a 44px row
                  below `md`, 32px above it and on the rail alike, and the
                  rail's `ml-1` rather than `mx-auto`, so the mark lands on
                  the same 28px axis the real rows use in both states. */}
              <div className="flex h-11 w-full items-center gap-2 px-2 md:h-8 group-data-[collapsible=icon]:ml-1 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
                <SidebarRowSlot>
                  {/* The 24px Channel tile, which is what a room row's mark is
                      in both states. */}
                  <Skeleton className="size-6" />
                </SidebarRowSlot>
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
