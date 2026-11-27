import { ChevronsUpDown } from "lucide-react";
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
export type WorkspaceSwitcherPlacement =
  | "sidebar"
  | "drawer"
  | "topBar"
  | "rail";

/** The rail's trigger: the avatar alone, as large as the 64px cell comfortably holds. */
export const WORKSPACE_SWITCHER_RAIL_AVATAR_CLASS = "size-8 md:size-8";

interface WorkspaceSwitcherPlacementProps {
  placement: WorkspaceSwitcherPlacement;
}

/** As wide as its content, and no wider than its slot: the name gives way. */
export const WORKSPACE_SWITCHER_ROW_CLASS =
  "flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md text-sm md:gap-2 md:px-2";

export const WORKSPACE_SWITCHER_AVATAR_CLASS = "size-4 shrink-0 md:size-5";

/** Shortened with "…" in the sidebar; read out but not shown on a phone. */
export const WORKSPACE_SWITCHER_NAME_CLASS =
  "min-w-0 truncate text-left font-medium ";

/**
 * The up/down chevrons, the same mark the project selector uses, so both
 * pickers read alike and neither reads as a section's fold or as a swap: small in the sidebar, the
 * size the chevron had in the phone's top bar.
 */
export function WorkspaceSwitcherArrows({
  placement,
}: WorkspaceSwitcherPlacementProps) {
  return (
    <ChevronsUpDown
      className={cn(
        "text-muted-foreground shrink-0",
        placement === "topBar" ? "size-4" : "size-3",
      )}
    />
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
      <span className="bg-muted h-3 w-20 animate-pulse rounded-md " />
    </>
  );
}

/** The switcher while its workspaces load, in the shape it loads into. */
export function WorkspaceSwitcherSkeleton({
  placement,
}: WorkspaceSwitcherPlacementProps) {
  if (placement === "rail") {
    return (
      <span
        aria-hidden
        data-testid="workspace-switcher-chrome-skeleton"
        className={cn(
          "bg-muted animate-pulse rounded-full",
          WORKSPACE_SWITCHER_RAIL_AVATAR_CLASS,
        )}
      />
    );
  }
  return (
    <div
      className={cn(
        WORKSPACE_SWITCHER_ROW_CLASS,
        placement !== "sidebar" && "w-full",
      )}
      aria-hidden
      data-testid="workspace-switcher-chrome-skeleton"
    >
      <WorkspaceSwitcherSkeletonParts />
      <WorkspaceSwitcherArrows placement={placement} />
    </div>
  );
}
