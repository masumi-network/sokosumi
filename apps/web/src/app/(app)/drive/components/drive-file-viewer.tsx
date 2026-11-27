"use client";

import { getExtensionFromUrl } from "@sokosumi/utils";
import { Download, ExternalLink, XIcon } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";
import { CropForSocial } from "@/app/drive/components/crop-for-social";
import {
  contentUrl,
  effectiveType,
  rendersAsMarkdown,
} from "@/app/drive/components/drive-file-preview";
import { GoogleSheetBar } from "@/app/drive/components/google-sheet-bar";
import { MarkdownDownloadMenu } from "@/app/drive/components/markdown-download-menu";
import { TableCreateDialog } from "@/app/drive/tables/table-create-dialog";
import { CapTableFileView } from "@/components/cap-table/cap-table-view";
import { SpreadsheetFileView } from "@/components/spreadsheet/spreadsheet-view";
import { TeamFileView } from "@/components/team/team-view";
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
import { isCapTableFileName } from "@/lib/cap-table-file";
import { spreadsheetKind } from "@/lib/spreadsheet-file";
import { isTeamFileName } from "@/lib/team-file";
import { cn } from "@/lib/utils";
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
  /** The Drive pathname, when the file has one; offers Crop for social on images. */
  pathname?: string | null;
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
  // A refreshed Google Sheet rewrites the bytes at the same address.
  const [version, setVersion] = useState(0);
  if (!file) return null;

  const url = contentUrl({ resourceId: file.id, store });
  const type = effectiveType(file.mimeType, file.displayName);
  const kind = classifyFilePreview(url, file.displayName, type);
  const sheet = spreadsheetKind(type, file.displayName);

  const media = {
    fileName: file.displayName,
    sizeBytes: file.sizeBytes ?? null,
    url,
    downloadUrl: contentUrl({ resourceId: file.id, store, download: true }),
    detailsHref: `/drive/files/${file.id}`,
    onClose,
  };

  const capTable = isCapTableFileName(file.displayName);
  if (isTeamFileName(file.displayName) || capTable || sheet) {
    // Same header as every other file: a table preview still needs Download.
    return (
      <FileMediaDialog
        {...media}
        media={null}
        action={
          sheet ? (
            <TableCreateDialog
              workspaceId={store.organizationId ?? null}
              sourceFile={{ url, name: file.displayName, kind: sheet }}
            />
          ) : null
        }
      >
        {capTable ? (
          <CapTableFileView url={url} />
        ) : sheet ? (
          <SpreadsheetFileView url={url} kind={sheet} />
        ) : (
          <TeamFileView url={url} />
        )}
      </FileMediaDialog>
    );
  }

  if (kind.isImage) {
    return (
      <ImageViewer
        images={[{ src: url, alt: file.displayName }]}
        activeSrc={url}
        onActiveSrcChange={(src) => {
          if (src === null) onClose();
        }}
        actions={
          file.pathname ? (
            <CropForSocial
              pathname={file.pathname}
              name={file.displayName}
              mimeType={file.mimeType}
              sizeBytes={file.sizeBytes ?? null}
              store={store}
            />
          ) : null
        }
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
        url={version ? `${url}&v=${version}` : url}
        fileName={file.displayName}
        kind={kind.documentKind}
        mediaType={type}
        download={
          rendersAsMarkdown(type) ? (
            <MarkdownDownloadMenu
              url={url}
              downloadUrl={media.downloadUrl}
              fileName={file.displayName}
              sizeBytes={file.sizeBytes ?? null}
              className="size-10 gap-1.5 px-0 sm:w-auto sm:px-3 md:h-8"
              labelClassName="hidden sm:inline"
            />
          ) : undefined
        }
        banner={
          <GoogleSheetBar
            resourceId={file.id}
            store={store}
            onRefreshed={() => setVersion((value) => value + 1)}
          />
        }
      />
    );
  }

  return (
    <FileMediaDialog
      {...media}
      media={kind.isVideo ? "video" : kind.isAudio ? "audio" : null}
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
  /** A preview to show in place of the player or the download fallback. */
  children?: ReactNode;
  /** One more header button, before Details. */
  action?: ReactNode;
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
  children,
  action,
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
        className={cn(
          "flex max-h-[92dvh] flex-col gap-0 overflow-hidden overscroll-contain p-0",
          children ? "sm:max-w-6xl" : "sm:max-w-3xl",
        )}
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
            {action}
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
        <div
          className={
            children
              ? "min-h-0 overflow-y-auto p-4 sm:p-6"
              : "flex min-h-64 items-center justify-center p-6"
          }
        >
          {children ? (
            children
          ) : media === "video" ? (
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
