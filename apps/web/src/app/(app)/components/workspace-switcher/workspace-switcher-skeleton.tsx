import { ChevronDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/*
 * The **Workspace switcher**'s shape (GLOSSARY.md), shared by its triggers and
 * their placeholders. Not a client module, so the Instant Nav shells, which
 * are Server Components, get the strings and not client references.
 *
 * It has two homes that never show at once, split at md (the phone/desktop
 * boundary, `MOBILE_BREAKPOINT`): below it the phone's top bar, where only the
 * avatar and chevron show, and from it the start of the sidebar header, as
 * wide as its content. So the md: half of each class is the sidebar's.
 */

/**
 * Where a Workspace switcher trigger sits. CSS decides which one shows; the
 * placement decides what differs between them.
 */
export type WorkspaceSwitcherPlacement = "sidebar" | "topBar";

interface WorkspaceSwitcherPlacementProps {
  placement: WorkspaceSwitcherPlacement;
}

/** As wide as its content, and no wider than its slot: the name gives way. */
export const WORKSPACE_SWITCHER_ROW_CLASS =
  "flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md text-sm md:gap-2 md:px-2";

export const WORKSPACE_SWITCHER_AVATAR_CLASS = "size-4 shrink-0 md:size-5";

/** Shortened with "…" in the sidebar; read out but not shown on a phone. */
export const WORKSPACE_SWITCHER_NAME_CLASS =
  "min-w-0 truncate text-left font-medium max-md:sr-only";

/**
 * The sidebar's small down chevron, as in Linear; the phone's top bar keeps
 * the up-down selector chevron it had.
 */
export function WorkspaceSwitcherChevron({
  placement,
}: WorkspaceSwitcherPlacementProps) {
  return placement === "sidebar" ? (
    <ChevronDown className="text-muted-foreground size-3.5 shrink-0" />
  ) : (
    <ChevronsUpDown className="text-muted-foreground size-4 shrink-0" />
  );
}

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
      <span className="bg-muted h-3 w-20 animate-pulse rounded-md max-md:hidden" />
    </>
  );
}

/** The switcher while its workspaces load, in the shape it loads into. */
export function WorkspaceSwitcherSkeleton({
  placement,
}: WorkspaceSwitcherPlacementProps) {
  return (
    <div
      className={WORKSPACE_SWITCHER_ROW_CLASS}
      aria-hidden
      data-testid="workspace-switcher-chrome-skeleton"
    >
      <WorkspaceSwitcherSkeletonParts />
      <WorkspaceSwitcherChevron placement={placement} />
    </div>
  );
}
