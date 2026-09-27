import {
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";

const DRIVE_ITEMS_GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

/**
 * The app's large-surface panel: the background and corner every big component
 * on a page sits on, without the item list's own inner padding. The members
 * data table (`rounded-xl bg-card-background p-2`) is the same treatment.
 *
 * `bg-card-background` and not `bg-card`: `--card` equals `--background` in
 * dark mode and white-on-white in light, so a `bg-card` panel is invisible
 * against the page in both themes and reads as bare page with a border.
 */
/**
 * Height of a control in the Files header row, 40px on touch and 32px from
 * `md` up, matching the `size="sm"` buttons it sits beside.
 *
 * The row is `items-center`, so its height is whatever its tallest child is,
 * and the tab strip is then centred inside it. A bare `Input` is `h-10`, so a
 * tab that showed a search box made the row 40px while a tab without one made
 * it 36px (the tab strip's own height) — and the strip, with everything under
 * it, moved 2px down and back up on every tab switch. Every control in that
 * row has to agree on a height at or under the strip's for the switch to be
 * still.
 */
export const DRIVE_TOOLBAR_CONTROL_CLASS = "h-10 md:h-8";

export const DRIVE_SURFACE_PANEL_CLASS =
  "bg-card-background overflow-hidden rounded-xl";

export function driveItemsPanelClass(_viewMode: FilesViewMode): string {
  return cn(DRIVE_SURFACE_PANEL_CLASS, "p-2", PROJECTS_LIST_CARD_MIN_H_CLASS);
}

export function driveItemsListClass(viewMode: FilesViewMode): string {
  return viewMode === "grid" ? DRIVE_ITEMS_GRID_CLASS : "flex flex-col gap-2";
}

export function driveRecentsDayItemsClass(viewMode: FilesViewMode): string {
  return viewMode === "grid" ? DRIVE_ITEMS_GRID_CLASS : "flex flex-col gap-2";
}

export function driveItemArticleClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "group bg-background relative flex items-center gap-2 rounded-lg border border-border p-3 hover:bg-card-background"
    : cn(
        "bg-background relative flex items-center gap-1 rounded-lg border border-border px-2 hover:bg-card-background-hover",
        PROJECTS_LIST_ROW_LAYOUT_CLASS,
      );
}

export function driveItemBodyClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "flex min-w-0 flex-1 items-center gap-2"
    : "flex min-w-0 flex-1 items-center gap-4 py-3 px-2";
}

export function driveItemIconWellClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "bg-muted flex size-10 shrink-0 items-center justify-center rounded-lg"
    : "flex size-8 shrink-0 items-center justify-center";
}

/** Matches Lucide Folder `size-5`; flex centers the svg (keeps 40×48 aspect). */
export const DRIVE_FILE_TYPE_ICON_CLASS =
  "flex size-5 shrink-0 items-center justify-center [&_svg]:h-5 [&_svg]:w-auto";

/** Grid: one-line size · date. List: mobile-only row; desktop uses `driveItemMetaDesktopClass`. */
export function driveItemMetaMobileClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "text-muted-foreground flex items-center text-xs [&>span+span]:before:mx-1 [&>span+span]:before:content-['·']"
    : "text-muted-foreground flex items-center gap-3 text-xs md:hidden";
}

export function driveItemMetaDesktopClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "hidden"
    : "text-muted-foreground hidden shrink-0 items-center gap-3 text-xs md:flex";
}

export function driveItemActionsClass(viewMode: FilesViewMode): string {
  return viewMode === "grid" ? "shrink-0 pl-1" : "shrink-0 pl-2";
}

export function driveItemNameClass(): string {
  return "text-foreground line-clamp-1 text-sm font-medium";
}
