"use client";

import type { DriveStars } from "@sokosumi/core-client";
import { getExtensionFromUrl } from "@sokosumi/utils";
import { Folder, Star } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import {
  DRIVE_FILE_TYPE_ICON_CLASS,
  DRIVE_SURFACE_PANEL_CLASS,
  driveItemArticleClass,
  driveItemBodyClass,
  driveItemIconWellClass,
  driveItemNameClass,
} from "@/app/drive/components/drive-view-layout";
import type { DriveStarTarget } from "@/app/drive/components/use-drive-stars";
import { Button } from "@/components/ui/button";
import { FileTypeIcon } from "@/components/ui/file-icon";
import { cn } from "@/lib/utils";

/**
 * Starred folders and files at the top of Recents, each one click away.
 * Folders first: they are where people go to work, files are what they open.
 */
export function DriveStarredSection({
  stars,
  onUnstar,
}: {
  stars: DriveStars;
  onUnstar: (target: DriveStarTarget) => void;
}) {
  const t = useTranslations("App.Drive.Stars");
  if (stars.folders.length === 0 && stars.files.length === 0) return null;

  function row(input: {
    key: string;
    href: string;
    name: string;
    icon: ReactNode;
    target: DriveStarTarget;
  }) {
    return (
      <li key={input.key}>
        <div className={driveItemArticleClass("list")}>
          <Link
            href={input.href}
            className={cn(
              driveItemBodyClass("list"),
              "focus-visible:ring-ring rounded-md focus-visible:outline-none focus-visible:ring-2",
            )}
          >
            <span className={driveItemIconWellClass("list")} aria-hidden>
              {input.icon}
            </span>
            <span className={driveItemNameClass()}>{input.name}</span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10 shrink-0 md:size-8"
            aria-label={t("unstarItem", { name: input.name })}
            title={t("unstar")}
            onClick={() => onUnstar(input.target)}
          >
            <Star className="size-4 fill-current" aria-hidden />
          </Button>
        </div>
      </li>
    );
  }

  return (
    <section
      aria-labelledby="drive-starred-heading"
      className={cn(DRIVE_SURFACE_PANEL_CLASS, "mb-4 p-2")}
      data-testid="drive-starred"
    >
      <h2
        id="drive-starred-heading"
        className="text-muted-foreground px-2 pt-1 pb-2 text-xs font-medium"
      >
        {t("heading")}
      </h2>
      <ul className="flex flex-col gap-2">
        {stars.folders.map((folder) =>
          row({
            key: `folder:${folder.path}`,
            href: `/drive?${new URLSearchParams({ view: "workspace", folder: folder.path })}`,
            name: folder.name,
            icon: <Folder className="size-5" aria-hidden />,
            target: { folderPath: folder.path },
          }),
        )}
        {stars.files.map((file) =>
          row({
            key: `file:${file.id}`,
            href: `/drive/files/${file.id}`,
            name: file.displayName,
            icon: (
              <span className={DRIVE_FILE_TYPE_ICON_CLASS}>
                <FileTypeIcon
                  extension={getExtensionFromUrl(file.displayName) || "file"}
                />
              </span>
            ),
            target: { resourceId: file.id },
          }),
        )}
      </ul>
    </section>
  );
}
