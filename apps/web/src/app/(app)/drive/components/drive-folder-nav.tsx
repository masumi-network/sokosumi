"use client";

import { ChevronRight, Folder } from "lucide-react";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
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
}: {
  folders: string[];
  current: string;
  onSelect: (folder: string) => void;
  actions?: ReactNode;
}) {
  const t = useTranslations("App.Drive.Files");
  const children = childFolders(folders, current);

  // Nothing to navigate: no folders anywhere and none entered. A trail with
  // only "All files" on it would be furniture.
  if (folders.length === 0 && !current) return null;

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

      {children.length > 0 ? (
        <ul
          className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4"
          data-testid="drive-folder-children"
        >
          {children.map((folder) => (
            <li key={folder}>
              <button
                type="button"
                className="bg-card-background hover:bg-card-background-hover focus-visible:ring-ring flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2"
                title={folder}
                onClick={() => onSelect(folder)}
              >
                <Folder
                  className="text-muted-foreground size-5 shrink-0"
                  aria-hidden
                />
                <span className="truncate">{folder.split("/").at(-1)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
