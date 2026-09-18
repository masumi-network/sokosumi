import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import CustomTrigger from "./sidebar/components/custom-trigger";
import MenuItems from "./sidebar/components/menu-items";
import { SidebarChatListSkeleton } from "./sidebar/components/sidebar-chat-list-skeleton";
import SidebarLogo from "./sidebar/components/sidebar-logo.client";
import { SidebarAccountChipFallback } from "./sidebar-deferred-account";

/**
 * The sidebar while `AuthenticatedAppFrame` is still suspended.
 *
 * Logo, trigger and nav are static client components with no session behind
 * them — `MenuItems` already soft-reads its dialog providers for exactly this
 * shell — so they render for real rather than as placeholders. Nothing here
 * redraws when the real sidebar streams in, and the rail's collapsed state is
 * already applied by `SidebarBootScript`, so both states paint their finished
 * shape on the first frame.
 *
 * Only the two session-backed surfaces are placeholders: the room list and
 * the account chip.
 */
export function AppSidebarFallback() {
  return (
    <Sidebar collapsible="icon">
      {/* Mirrors `Sidebar`'s own header so the hairline lands on the same
          line across the shell/sidebar swap. */}
      <SidebarHeader className="border-sidebar-border h-16 border-b p-0">
        <div className="flex h-full w-full items-center justify-between gap-2 px-2 group-data-[collapsible=icon]:justify-center">
          <SidebarLogo />
          <CustomTrigger className="group-data-[collapsible=icon]:hidden shrink-0" />
        </div>
      </SidebarHeader>
      <SidebarContent className="min-h-0 w-full flex-1">
        <div className="flex w-full flex-col gap-0">
          {/* Soko Bot's nav and the Calendar row are beta-gated on membership
              this frame has not loaded yet, so both are left out rather than
              guessed: a row that appears once is cheaper than one that
              appears and then goes away. */}
          <MenuItems calendarMenuEnabled={false} />
          <SidebarSeparator />
          <SidebarChatListSkeleton />
        </div>
      </SidebarContent>
      {/* Hairline twin of the header's, matching `Sidebar`'s own footer: it
          marks the footer as chrome so the chip does not read as one more
          room, and carrying it here keeps the rule from appearing when the
          streamed sidebar takes over. */}
      <SidebarFooter className="border-sidebar-border mt-auto shrink-0 border-t px-0">
        <div className="p-2 pt-0 pb-[env(safe-area-inset-bottom)] group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <SidebarAccountChipFallback />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
