import { SidebarProjectScopeSkeleton } from "@/app/components/project-scope/sidebar-project-scope-shape";
import { SidebarWorkspaceRow } from "@/app/components/workspace-switcher/sidebar-workspace-row";
import { WorkspaceSwitcherSkeleton } from "@/app/components/workspace-switcher/workspace-switcher-skeleton";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { SIDEBAR_PROJECT_SCOPED_CLASS } from "@/components/ui/sidebar-classes";
import { GlobalRail } from "./sidebar/components/global-rail.client";
import MenuItems from "./sidebar/components/menu-items";
import { SidebarChatListSkeleton } from "./sidebar/components/sidebar-chat-list-skeleton";
import { SidebarContextPanel } from "./sidebar/components/sidebar-context-panel";
import { SidebarAccountChipFallback } from "./sidebar-deferred-account";

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
 * the project title, the room list and the account chip.
 */
export function AppSidebarFallback() {
  return (
    <Sidebar
      mobileTriggerId="app-sidebar-toggle"
      className="md:top-16 md:h-[calc(100dvh-4rem)] md:pt-12 md:left-(--app-rail-width) md:group-data-[collapsible=offcanvas]:left-[calc(var(--app-rail-width)-var(--sidebar-width))]"
    >
      <SidebarWorkspaceRow mobile>
        <WorkspaceSwitcherSkeleton placement="sidebar" />
      </SidebarWorkspaceRow>
      <GlobalRail mobile />
      <SidebarContent className="min-h-0 w-full flex-1">
        <div className="flex w-full flex-col gap-0">
          {/* Soko Bot's nav and the Ads row are beta-gated on membership
              this frame has not loaded yet, so both are left out rather than
              guessed: a row that appears once is cheaper than one that
              appears and then goes away. */}
          {/* The project title's scope is session-backed, so it is a
              placeholder in the title's shape, and the line the groups hang
              from has something to start under. */}
          <SidebarContextPanel chats={<SidebarChatListSkeleton />}>
            <SidebarProjectScopeSkeleton />
            <div className={SIDEBAR_PROJECT_SCOPED_CLASS}>
              <MenuItems />
            </div>
          </SidebarContextPanel>
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
