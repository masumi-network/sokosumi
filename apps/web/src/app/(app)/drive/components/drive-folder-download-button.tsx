"use client";

import { Download } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useFilesArchiveDownload } from "@/hooks/use-files-archive-download";
import {
  type ArchiveFile,
  FOLDER_ARCHIVE_MAX_FILES,
} from "@/lib/files-archive";
import {
  type DriveWorkspaceStore,
  listDriveItems,
} from "@/lib/utils/drive-file-list.client";

/**
 * Every file under `folder`, with its path inside the zip relative to it.
 * A data room's bytes are private and its link cannot open them, so a room
 * is not walked: its path goes to `rooms` for the reader to be told.
 */
export async function listFolderFiles(
  store: DriveWorkspaceStore,
  folder: string,
  signal: AbortSignal,
  rooms: string[] = [],
  relative = "",
): Promise<ArchiveFile[]> {
  const items = await listDriveItems({ ...store, folder, signal });
  const files: ArchiveFile[] = [];
  for (const item of items) {
    const path = relative ? `${relative}/${item.name}` : item.name;
    if (item.dataRoom) {
      // A file is only in a room through its folder, so name the room once.
      if (item.type === "folder") rooms.push(path);
    } else if (item.type === "file") {
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
          rooms,
          path,
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
      onClick={async () => {
        const rooms: string[] = [];
        const done = await download(
          name,
          (signal) => listFolderFiles(store, folder, signal, rooms),
          FOLDER_ARCHIVE_MAX_FILES,
        );
        if (done && rooms.length > 0) {
          toast.info(
            t("downloadFolderRoomsLeftOut", { names: rooms.join(", ") }),
            { duration: 15_000 },
          );
        }
      }}
    >
      <Download className="size-4" aria-hidden />
      <span className="hidden @lg:inline">{t("downloadFolderButton")}</span>
    </Button>
  );
}
