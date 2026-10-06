"use client";

import { Download, ExternalLink, FileText, XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  contentUrl,
  effectiveType,
} from "@/app/drive/components/drive-file-preview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { DocumentViewer } from "@/components/ui/document-viewer";
import { ImageViewer } from "@/components/ui/image-viewer";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import type { FileStore } from "@/lib/utils/file-search.client";

/**
 * One file, opened from its row, in the same viewer a task's files open in.
 *
 * This was a side sheet around the whole detail screen, a third way to look at
 * a file next to the task image viewer and the document dialog. Images now open
 * in `ImageViewer` and PDFs and text in `DocumentViewer` — the components a
 * task output uses — so a file looks the same wherever it is opened from.
 *
 * Everything is read through the authorized same-origin content route, never a
 * storage URL. Office files, video, audio and anything unknown fall to a dialog
 * with the same header, because the Office embed needs a public URL this route
 * deliberately is not.
 */
export interface DriveFileViewerFile {
  id: string;
  displayName: string;
  mimeType: string | null;
}

export function DriveFileViewer({
  file,
  store,
  onClose,
}: {
  /** The file to show, or null when the viewer is closed. */
  file: DriveFileViewerFile | null;
  store: FileStore;
  onClose: () => void;
}) {
  if (!file) return null;

  const url = contentUrl({ resourceId: file.id, store });
  const type = effectiveType(file.mimeType, file.displayName);
  const kind = classifyFilePreview(url, file.displayName, type);

  if (kind.isImage) {
    return (
      <ImageViewer
        images={[{ src: url, alt: file.displayName }]}
        activeSrc={url}
        onActiveSrcChange={(src) => {
          if (src === null) onClose();
        }}
      />
    );
  }

  if (kind.documentKind === "pdf" || kind.documentKind === "text") {
    return (
      <DocumentViewer
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
        url={url}
        fileName={file.displayName}
        kind={kind.documentKind}
        mediaType={type}
      />
    );
  }

  return (
    <FallbackViewer
      file={file}
      store={store}
      url={url}
      isVideo={kind.isVideo}
      isAudio={kind.isAudio}
      onClose={onClose}
    />
  );
}

function FallbackViewer({
  file,
  store,
  url,
  isVideo,
  isAudio,
  onClose,
}: {
  file: DriveFileViewerFile;
  store: FileStore;
  url: string;
  isVideo: boolean;
  isAudio: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("App.Drive.Files");
  const download = contentUrl({ resourceId: file.id, store, download: true });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        data-testid="drive-file-viewer"
      >
        <div className="border-border flex items-center justify-between gap-2 border-b py-3 pr-4 pl-4 sm:py-4 sm:pr-6 sm:pl-6">
          <div className="flex min-w-0 items-center gap-2">
            <FileText
              className="text-muted-foreground size-4 shrink-0"
              aria-hidden
            />
            <DialogTitle className="truncate text-base font-medium">
              {file.displayName}
            </DialogTitle>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <Button
              asChild
              variant="outline"
              size="icon"
              className="size-10 sm:w-auto sm:gap-1.5 sm:px-3 md:h-8"
            >
              <Link
                href={`/drive/files/${file.id}`}
                aria-label={t("viewerDetails")}
                title={t("viewerDetails")}
              >
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("viewerDetails")}</span>
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              size="icon"
              className="size-10 sm:w-auto sm:gap-1.5 sm:px-3 md:h-8"
            >
              <a
                download={file.displayName}
                href={download}
                aria-label={t("previewDownload")}
                title={t("previewDownload")}
              >
                <Download className="size-3.5" aria-hidden />
                <span className="hidden sm:inline">{t("previewDownload")}</span>
              </a>
            </Button>
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 md:size-8"
                aria-label={t("viewerClose")}
                title={t("viewerClose")}
              >
                <XIcon className="size-3.5" aria-hidden />
              </Button>
            </DialogClose>
          </div>
        </div>
        <DialogDescription className="sr-only">
          {t("sheetDescription")}
        </DialogDescription>
        <div className="flex min-h-64 items-center justify-center p-6">
          {isVideo ? (
            <video
              src={url}
              controls
              preload="metadata"
              className="max-h-[70dvh] w-full rounded-lg bg-scrim-soft"
            />
          ) : isAudio ? (
            <audio
              src={url}
              controls
              preload="metadata"
              className="w-full"
              aria-label={file.displayName}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <FileText className="text-muted-foreground size-9" aria-hidden />
              <p className="text-muted-foreground max-w-xs text-sm">
                {t("viewerNoPreview")}
              </p>
              <Button asChild>
                <a download={file.displayName} href={download}>
                  <Download className="size-4" aria-hidden />
                  {t("previewDownload")}
                </a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
