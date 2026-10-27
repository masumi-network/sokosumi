import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The **Workspace switcher**'s shape (GLOSSARY.md), shared by the trigger and
 * its placeholders. Not a client module, so the Instant Nav shells, which are
 * Server Components, get the strings and not client references.
 *
 * It has two homes that never show at once: the phone's top bar, where only
 * the avatar and chevron show, and from md the row that fills the sidebar
 * header. So the md: half of each class is the sidebar's.
 */
const WORKSPACE_SWITCHER_ROW_CLASS =
  "flex h-8 min-w-0 items-center gap-1.5 rounded-md text-sm md:w-full md:gap-2 md:px-2";

export const WORKSPACE_SWITCHER_TRIGGER_CLASS = cn(
  WORKSPACE_SWITCHER_ROW_CLASS,
  "text-foreground press transition-[opacity,background-color] max-md:hover:opacity-80 md:hover:bg-sidebar-accent md:data-[state=open]:bg-sidebar-accent",
);

export const WORKSPACE_SWITCHER_AVATAR_CLASS = "size-4 shrink-0 md:size-5";

/** Shortened with "…" in the sidebar; read out but not shown on a phone. */
export const WORKSPACE_SWITCHER_NAME_CLASS =
  "min-w-0 max-w-24 flex-1 truncate text-left font-medium max-sm:sr-only md:max-w-none";

export const WORKSPACE_SWITCHER_CHEVRON_CLASS =
  "text-muted-foreground size-4 shrink-0";

/** The avatar and name placeholders, in the order the loaded ones take. */
export function WorkspaceSwitcherSkeletonParts() {
  return (
    <>
      <span
        className={cn(
          "bg-muted animate-pulse rounded-full",
          WORKSPACE_SWITCHER_AVATAR_CLASS,
        )}
      />
      <span className="bg-muted h-3 w-20 animate-pulse rounded-md max-sm:hidden" />
    </>
  );
}

/** The switcher while its workspaces load, in the shape it loads into. */
export function WorkspaceSwitcherSkeleton() {
  return (
    <div
      className={WORKSPACE_SWITCHER_ROW_CLASS}
      aria-hidden
      data-testid="workspace-switcher-chrome-skeleton"
    >
      <WorkspaceSwitcherSkeletonParts />
      <ChevronsUpDown className={WORKSPACE_SWITCHER_CHEVRON_CLASS} />
    </div>
  );
}
