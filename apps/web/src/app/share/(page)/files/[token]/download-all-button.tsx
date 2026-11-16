"use client";

import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFilesArchiveDownload } from "@/hooks/use-files-archive-download";
import { FOLDER_ARCHIVE_MAX_FILES } from "@/lib/files-archive";
import { sharedFolderArchiveFiles } from "./share-download";

export function SharedFolderDownloadAllButton({
  token,
  name,
  paths,
  label,
}: {
  token: string;
  name: string;
  paths: string[];
  label: string;
}) {
  const { downloading, download } = useFilesArchiveDownload();
  return (
    <Button
      type="button"
      variant="outline"
      className="ml-auto shrink-0"
      loading={downloading}
      onClick={() =>
        void download(
          name,
          () => sharedFolderArchiveFiles(token, paths),
          FOLDER_ARCHIVE_MAX_FILES,
        )
      }
    >
      <Download aria-hidden className="size-4" />
      {label}
    </Button>
  );
}
