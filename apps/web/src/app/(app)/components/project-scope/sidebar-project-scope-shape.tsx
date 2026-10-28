import { ArrowLeftRight } from "lucide-react";
import { SidebarGroup } from "@/components/ui/sidebar";

/*
 * The project title's shape, shared by the title and its Instant Nav
 * placeholder. Not a client module, so the shell, a Server Component, gets
 * the strings and not client references.
 */

/**
 * Phone sheet only: from md the header's selector is the scope's control. No
 * bottom padding: the nav's line starts right under the title. No top
 * padding either: the Soko Bot group's own bottom padding is the gap, so the
 * title stays close to the bot above it.
 */
export const SCOPE_TITLE_GROUP_CLASS = "w-full px-2 pt-0 pb-0 md:hidden";

/**
 * Not a Sidebar row: no leading mark, so the name starts where a section
 * heading's title does. 44px, for a thumb. As wide as its
 * name and arrows, like the workspace switcher, so the hover and open fill
 * cover the control and not the sidebar's width; capped at the group's width
 * so a long name still shortens with "…".
 */
export const SCOPE_TITLE_ROW_CLASS =
  "flex h-11 w-fit max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-left text-sm font-medium";

/** The switch arrows, so the selector does not read as a section's fold. */
export const SCOPE_TITLE_ARROWS_CLASS = "text-muted-foreground size-3 shrink-0";

/** The project title while the sidebar frame loads, in its shape. */
export function SidebarProjectScopeSkeleton() {
  return (
    <SidebarGroup className={SCOPE_TITLE_GROUP_CLASS}>
      <div
        className={SCOPE_TITLE_ROW_CLASS}
        aria-hidden
        data-testid="project-scope-title-skeleton"
      >
        <span className="bg-muted h-3 w-24 animate-pulse rounded-md" />
        <ArrowLeftRight className={SCOPE_TITLE_ARROWS_CLASS} />
      </div>
    </SidebarGroup>
  );
}
