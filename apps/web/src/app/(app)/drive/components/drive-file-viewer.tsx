"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import { Download, ExternalLink, XIcon } from "lucide-react";
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
import { FileTypeIcon } from "@/components/ui/file-icon";
import { ImageViewer } from "@/components/ui/image-viewer";
import { classifyFilePreview } from "@/lib/utils/file-preview";
import type { FileStore } from "@/lib/utils/file-search.client";
import { formatBytes } from "@/lib/utils/format-bytes";

/**
 * One file, opened from its row, in the same viewer a task's files open in.
 *
 * This was a side sheet around the whole detail screen, a third way to look at
 * a file next to the task image viewer and the document dialog. Images now open
 * in `ImageViewer` and PDFs and text in `DocumentViewer` — the components a
 * task output uses — so a file looks the same wherever it is opened from.
 *
 * Everything is read through the authorized same-origin content route, never a
 * storage URL. Office files, video, audio and anything unknown fall to
 * `FileMediaDialog`, because the Office embed needs a public URL this route
 * deliberately is not.
 */
export interface DriveFileViewerFile {
  id: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes?: number | null;
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
    <FileMediaDialog
      fileName={file.displayName}
      sizeBytes={file.sizeBytes ?? null}
      url={url}
      downloadUrl={contentUrl({ resourceId: file.id, store, download: true })}
      detailsHref={`/drive/files/${file.id}`}
      media={kind.isVideo ? "video" : kind.isAudio ? "audio" : null}
      onClose={onClose}
    />
  );
}

export interface FileMediaDialogProps {
  fileName: string;
  sizeBytes: number | null;
  /** Where the bytes are read from, inline. */
  url: string;
  /** The same bytes as an attachment. */
  downloadUrl: string;
  /** The file's detail view, when the catalog knows the file. */
  detailsHref: string | null;
  /** Played in place. Anything else is offered as a download. */
  media: "video" | "audio" | null;
  onClose: () => void;
}

/**
 * Video and audio play here. Every other type gets its name, its size and a
 * Download button, so no file is a row that does nothing when opened.
 */
export function FileMediaDialog({
  fileName,
  sizeBytes,
  url,
  downloadUrl,
  detailsHref,
  media,
  onClose,
}: FileMediaDialogProps) {
  const t = useTranslations("App.Drive.Files");
  const sizeLabel = formatBytes(sizeBytes);
  const extension = getExtensionFromUrl(fileName) || "file";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden overscroll-contain p-0 sm:max-w-3xl"
        data-testid="drive-file-viewer"
      >
        <div className="border-border flex items-center justify-between gap-2 border-b py-3 pr-4 pl-4 sm:py-4 sm:pr-6 sm:pl-6">
          <div className="flex min-w-0 items-center gap-2">
            <span className="size-5 shrink-0" aria-hidden>
              <FileTypeIcon extension={extension} />
            </span>
            <div className="flex min-w-0 flex-col">
              <DialogTitle className="truncate text-base font-medium">
                {fileName}
              </DialogTitle>
              {sizeLabel ? (
                <span className="text-muted-foreground text-xs tabular-nums">
                  {sizeLabel}
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            {detailsHref ? (
              <Button
                asChild
                variant="outline"
                size="icon"
                className="size-10 sm:w-auto sm:gap-1.5 sm:px-3 md:h-8"
              >
                <Link
                  href={detailsHref}
                  aria-label={t("viewerDetails")}
                  title={t("viewerDetails")}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  <span className="hidden sm:inline">{t("viewerDetails")}</span>
                </Link>
              </Button>
            ) : null}
            <Button
              asChild
              variant="outline"
              size="icon"
              className="size-10 sm:w-auto sm:gap-1.5 sm:px-3 md:h-8"
            >
              <a
                download={fileName}
                href={downloadUrl}
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
          {media === "video" ? (
            <video
              src={url}
              controls
              playsInline
              preload="metadata"
              aria-label={fileName}
              className="max-h-[70dvh] w-full rounded-lg bg-scrim-soft"
            />
          ) : media === "audio" ? (
            <audio
              src={url}
              controls
              preload="metadata"
              aria-label={fileName}
              className="w-full"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-center">
              <span className="size-10" aria-hidden>
                <FileTypeIcon extension={extension} />
              </span>
              <p className="text-muted-foreground max-w-xs text-sm">
                {t("viewerNoPreview")}
              </p>
              <Button asChild>
                <a download={fileName} href={downloadUrl}>
                  <Download className="size-4" aria-hidden />
                  {sizeLabel
                    ? t("viewerDownloadWithSize", { size: sizeLabel })
                    : t("previewDownload")}
                </a>
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
