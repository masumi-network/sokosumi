import {
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";

const DRIVE_ITEMS_GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5";

export function driveItemsPanelClass(viewMode: FilesViewMode): string {
  return cn(
    "bg-muted/30 border-border/50 -mx-6 overflow-hidden rounded-none border-0 md:mx-0 md:rounded-xl md:border",
    PROJECTS_LIST_CARD_MIN_H_CLASS,
    viewMode === "grid" ? "p-3" : undefined,
  );
}

export function driveItemsListClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? DRIVE_ITEMS_GRID_CLASS
    : "divide-border/50 divide-y px-2";
}

export function driveRecentsDayItemsClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? DRIVE_ITEMS_GRID_CLASS
    : "space-y-0 divide-y divide-border/50";
}

export function driveItemArticleClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "group relative flex items-center gap-2 rounded-lg border border-border/50 bg-background/60 p-3 hover:bg-muted/50"
    : cn(
        "relative -mx-2 flex items-center gap-1 rounded-lg px-2 hover:bg-muted/50",
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

/** Matches Lucide Folder `size-5` so react-file-icon does not fill the well. */
export const DRIVE_FILE_TYPE_ICON_CLASS = "size-5 shrink-0";

/** Grid: one-line size · date. List: mobile-only row; desktop uses `driveItemMetaDesktopClass`. */
export function driveItemMetaMobileClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "text-muted-foreground/70 flex items-center text-xs [&>span+span]:before:mx-1 [&>span+span]:before:content-['·']"
    : "text-muted-foreground/70 flex items-center gap-3 text-xs md:hidden";
}

export function driveItemMetaDesktopClass(viewMode: FilesViewMode): string {
  return viewMode === "grid"
    ? "hidden"
    : "text-muted-foreground/70 hidden shrink-0 items-center gap-3 text-xs md:flex";
}

export function driveItemActionsClass(viewMode: FilesViewMode): string {
  return viewMode === "grid" ? "shrink-0 pl-1" : "shrink-0 pl-2";
}

export function driveItemNameClass(): string {
  return "text-foreground line-clamp-1 text-sm font-medium";
}
