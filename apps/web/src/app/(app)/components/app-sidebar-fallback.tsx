import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import MenuItems from "./sidebar/components/menu-items";
import { SidebarChatListSkeleton } from "./sidebar/components/sidebar-chat-list-skeleton";
import SidebarLogo from "./sidebar/components/sidebar-logo.client";
import { SidebarAccountChipFallback } from "./sidebar-deferred-account";
import { WorkspaceSwitcherSkeleton } from "./workspace-switcher/workspace-switcher-skeleton";

/**
 * The sidebar while `AuthenticatedAppFrame` is still suspended.
 *
 * Logo and nav are static client components with no session behind them —
 * `MenuItems` already soft-reads its badge provider for exactly this shell —
 * so they render for real rather than as placeholders. Nothing here redraws
 * when the real sidebar streams in, and a hidden preference is already applied
 * by `SidebarBootScript`, so the first frame is already the finished state.
 *
 * Only the session-backed surfaces are placeholders: the Workspace switcher,
 * the room list and the account chip.
 */
export function AppSidebarFallback() {
  return (
    <Sidebar>
      {/* Mirrors `Sidebar`'s own header so the hairline lands on the same
          line across the shell/sidebar swap. New task is left out: it needs
          the wizard and a seat this frame has not loaded, and a button that
          appears once is cheaper than one that appears and then goes away. */}
      <SidebarHeader className="border-sidebar-border h-16 border-b p-0">
        <div className="flex size-full items-center justify-between gap-2 px-2">
          {/* The Workspace switcher's workspaces are session-backed, so it
              is a placeholder in the switcher's own shape. */}
          <div className="flex min-w-0 flex-1 max-md:hidden">
            <WorkspaceSwitcherSkeleton />
          </div>
          <SidebarLogo className="md:hidden" />
        </div>
      </SidebarHeader>
      <SidebarContent className="min-h-0 w-full flex-1">
        <div className="flex w-full flex-col gap-0">
          {/* Soko Bot's nav and the Ads row are beta-gated on membership
              this frame has not loaded yet, so both are left out rather than
              guessed: a row that appears once is cheaper than one that
              appears and then goes away. */}
          <MenuItems />
          <SidebarSeparator />
          <SidebarChatListSkeleton />
        </div>
      </SidebarContent>
      {/* Hairline twin of the header's, matching `Sidebar`'s own footer: it
          marks the footer as chrome so the chip does not read as one more
          room, and carrying it here keeps the rule from appearing when the
          streamed sidebar takes over. */}
      <SidebarFooter className="border-sidebar-border mt-auto shrink-0 border-t px-0">
        <div className="p-2 pt-0 pb-[env(safe-area-inset-bottom)]">
          <SidebarAccountChipFallback />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
