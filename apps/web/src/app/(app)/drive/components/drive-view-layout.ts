import {
  PROJECTS_LIST_CARD_MIN_H_CLASS,
  PROJECTS_LIST_ROW_LAYOUT_CLASS,
} from "@/app/projects/constants";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";

const DRIVE_ITEMS_GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

export function driveItemsPanelClass(_viewMode: FilesViewMode): string {
  return cn(
    "bg-card-background overflow-hidden rounded-xl p-2",
    PROJECTS_LIST_CARD_MIN_H_CLASS,
  );
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
