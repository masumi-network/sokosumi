"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useFilesArchiveDownload } from "@/hooks/use-files-archive-download";
import type { ArchiveFile } from "@/lib/files-archive";
import {
  type DriveWorkspaceStore,
  listDriveItems,
} from "@/lib/utils/drive-file-list.client";

/** Above the Task cap: a folder is often a whole delivery. Bytes stay capped by the shared budget. */
export const FOLDER_ARCHIVE_MAX_FILES = 200;

/**
 * Every file under `folder`, with its path inside the zip relative to it.
 * A data room's bytes are private, so its files fail to load and are named
 * as not included rather than silently dropped.
 */
export async function listFolderFiles(
  store: DriveWorkspaceStore,
  folder: string,
  signal: AbortSignal,
  relative = "",
): Promise<ArchiveFile[]> {
  const items = await listDriveItems({ ...store, folder, signal });
  const files: ArchiveFile[] = [];
  for (const item of items) {
    if (item.type === "file") {
      files.push({
        name: item.name,
        fileUrl: item.fileUrl,
        ...(relative ? { folder: relative } : {}),
      });
    } else {
      // ponytail: one request per subfolder, in order; fine for hand-made trees.
      files.push(
        ...(await listFolderFiles(
          store,
          `${folder}/${item.path}`,
          signal,
          relative ? `${relative}/${item.name}` : item.name,
        )),
      );
    }
  }
  return files;
}

export function DriveFolderDownloadButton({
  store,
  folder,
  name,
}: {
  store: DriveWorkspaceStore;
  folder: string;
  name: string;
}) {
  const t = useTranslations("App.Drive");
  const { downloading, download } = useFilesArchiveDownload();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="gap-1.5"
      data-testid="files-download-folder"
      aria-label={t("downloadFolderAction", { name })}
      loading={downloading}
      onClick={() =>
        void download(
          name,
          (signal) => listFolderFiles(store, folder, signal),
          FOLDER_ARCHIVE_MAX_FILES,
        )
      }
    >
      <Download className="size-4" aria-hidden />
      <span className="hidden @lg:inline">{t("downloadFolderButton")}</span>
    </Button>
  );
}
