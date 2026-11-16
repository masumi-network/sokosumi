"use client";

import { ChevronRight, Folder, FolderLock } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Folders as somewhere to go.
 *
 * They were a filter option inside a popover, which is a way to narrow a list
 * and not a way to find your way around a workspace. This is the way around: a
 * trail showing where the reader is, and the folders directly inside it as
 * buttons they can step into. The trail's parts are buttons too, so going up
 * is one click at any depth.
 *
 * It navigates the same catalog the search box searches. Picking a folder sets
 * the folder filter, so a query typed inside a folder searches that folder and
 * everything under it.
 *
 * `actions` is the current folder's own controls (rename, move, delete) and is
 * absent at the root, where there is no folder to act on.
 *
 * A data room's folder wears a lock and a quiet "Data room" label, here and in
 * the trail, so nobody forgets it is private; hovering or focusing it says who
 * can get in (`roomHint`).
 */

/** Folders directly inside `parent`, from a list that holds every ancestor. */
export function childFolders(folders: string[], parent: string): string[] {
  const prefix = parent ? `${parent}/` : "";
  const children = new Set<string>();
  for (const folder of folders) {
    if (!folder.startsWith(prefix) || folder === parent) continue;
    const next = folder.slice(prefix.length).split("/")[0];
    if (next) children.add(`${prefix}${next}`);
  }
  return [...children].sort((a, b) => a.localeCompare(b));
}

export function DriveFolderNav({
  folders,
  current,
  onSelect,
  actions,
  virtualFolder,
  roomPaths = [],
  roomHint,
}: {
  folders: string[];
  current: string;
  onSelect: (folder: string) => void;
  actions?: ReactNode;
  /** A folder that is not a path (Sokosumi Projects), listed at the root. */
  virtualFolder?: { label: string; onOpen: () => void };
  /** Folders that are data rooms. */
  roomPaths?: readonly string[];
  /** Who can open a data room's files, shown on hover and focus. */
  roomHint?: string;
}) {
  const t = useTranslations("App.Drive.Files");
  const rows = childFolders(folders, current).map((folder) => ({
    key: folder,
    label: folder.split("/").at(-1) ?? folder,
    onOpen: () => onSelect(folder),
  }));
  if (virtualFolder && !current) {
    rows.push({ key: "\0virtual", ...virtualFolder });
    rows.sort((a, b) => a.label.localeCompare(b.label));
  }

  // Nothing to navigate: no folders anywhere and none entered. A trail with
  // only "All files" on it would be furniture.
  if (folders.length === 0 && !current && !virtualFolder) return null;

  const segments = current ? current.split("/") : [];

  return (
    <div className="flex flex-col gap-3" data-testid="drive-folder-nav">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav
          aria-label={t("foldersLabel")}
          className="flex min-w-0 flex-wrap items-center gap-1 text-sm"
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={cn("px-2", !current && "font-medium")}
            aria-current={current ? undefined : "location"}
            disabled={!current}
            onClick={() => onSelect("")}
          >
            {t("foldersRoot")}
          </Button>
          {segments.map((segment, index) => {
            const path = segments.slice(0, index + 1).join("/");
            const isLast = index === segments.length - 1;
            return (
              <span key={path} className="flex items-center gap-1">
                <ChevronRight
                  className="text-muted-foreground size-4"
                  aria-hidden
                />
                {/* Its own control, so the hint is reachable by keyboard even
                    on the current folder, whose button is disabled. */}
                {roomPaths.includes(path) ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-muted-foreground focus-visible:ring-ring flex size-6 items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2"
                        aria-label={t("dataRoom")}
                      >
                        <FolderLock className="size-4" aria-hidden />
                      </button>
                    </TooltipTrigger>
                    {roomHint ? (
                      <TooltipContent>{roomHint}</TooltipContent>
                    ) : null}
                  </Tooltip>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn("max-w-48 px-2", isLast && "font-medium")}
                  aria-current={isLast ? "location" : undefined}
                  disabled={isLast}
                  title={path}
                  onClick={() => onSelect(path)}
                >
                  <span className="truncate">{segment}</span>
                </Button>
              </span>
            );
          })}
        </nav>
        {actions ? (
          <div className="flex items-center gap-1">{actions}</div>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <ul
          className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4"
          data-testid="drive-folder-children"
        >
          {rows.map((row) => {
            const isRoom = roomPaths.includes(row.key);
            const Icon = isRoom ? FolderLock : Folder;
            const button = (
              <button
                type="button"
                className="bg-card-background hover:bg-accent focus-visible:ring-ring flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2"
                title={isRoom ? undefined : row.label}
                onClick={row.onOpen}
              >
                <Icon
                  className="text-muted-foreground size-5 shrink-0"
                  aria-hidden
                />
                <span className="truncate">{row.label}</span>
                {isRoom ? (
                  <span className="text-muted-foreground shrink-0 font-normal">
                    <span aria-hidden>· </span>
                    {t("dataRoom")}
                  </span>
                ) : null}
              </button>
            );
            return (
              <li key={row.key}>
                {isRoom && roomHint ? (
                  <Tooltip>
                    <TooltipTrigger asChild>{button}</TooltipTrigger>
                    <TooltipContent>{roomHint}</TooltipContent>
                  </Tooltip>
                ) : (
                  button
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
