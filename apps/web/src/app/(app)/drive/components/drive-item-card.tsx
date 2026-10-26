"use client";

import type { MouseEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { createContext, use, useState } from "react";
import { FileMediaDialog } from "@/app/drive/components/drive-file-viewer";
import {
  driveItemActionsClass,
  driveItemArticleClass,
  driveItemBodyClass,
  driveItemNameClass,
} from "@/app/drive/components/drive-view-layout";
import { DocumentViewer } from "@/components/ui/document-viewer";
import { ImageViewer } from "@/components/ui/image-viewer";
import type { FilesViewMode } from "@/lib/ui-preferences/files-view-mode";
import { cn } from "@/lib/utils";
import { classifyFilePreview } from "@/lib/utils/file-preview";

const DriveItemNameA11yContext = createContext(false);

function stopCardActivation(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}

interface DriveItemCardBaseProps {
  viewMode: FilesViewMode;
  actions?: ReactNode;
  children: ReactNode;
}

type DriveItemCardProps = DriveItemCardBaseProps &
  (
    | { onActivate: () => void; activateLabel: string }
    | { onActivate?: undefined; activateLabel?: string }
  );

export function driveItemActivation(
  onActivate: (() => void) | undefined,
  activateLabel: string,
): { onActivate: () => void; activateLabel: string } | Record<string, never> {
  if (!onActivate) {
    return {};
  }
  return { onActivate, activateLabel };
}

export function DriveItemCard(props: DriveItemCardProps): ReactElement {
  const { viewMode, actions, children } = props;
  const isActivatable = props.onActivate != null;
  const onActivate = isActivatable ? props.onActivate : undefined;
  const activateLabel = isActivatable ? props.activateLabel : undefined;

  return (
    <DriveItemNameA11yContext value={isActivatable}>
      <article className={driveItemArticleClass(viewMode)}>
        {onActivate ? (
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-pointer rounded-[inherit]"
            aria-label={activateLabel}
            onClick={onActivate}
          />
        ) : null}
        <div
          className={cn(
            driveItemBodyClass(viewMode),
            "relative z-[1]",
            isActivatable ? "pointer-events-none" : undefined,
          )}
        >
          {children}
        </div>
        {actions ? (
          <div
            className={cn(driveItemActionsClass(viewMode), "relative z-[1]")}
            onClick={stopCardActivation}
            onPointerDown={stopCardActivation}
          >
            {actions}
          </div>
        ) : null}
      </article>
    </DriveItemNameA11yContext>
  );
}

export function DriveItemName({
  name,
  className,
}: {
  name: string;
  className?: string;
}): ReactElement {
  const hideNameFromAt = use(DriveItemNameA11yContext);

  return (
    <span
      className={cn(driveItemNameClass(), className)}
      title={name}
      aria-hidden={hideNameFromAt || undefined}
    >
      {name}
    </span>
  );
}

interface DriveFilePreviewApi {
  activate: (() => void) | undefined;
  nameEl: ReactNode;
  viewers: ReactNode;
}

interface DriveFilePreviewProps {
  name: string;
  fileUrl: string;
  sizeBytes: number | null;
  /** The file's detail view, when the catalog knows the file. */
  detailsHref: string | null;
  children: (api: DriveFilePreviewApi) => ReactNode;
}

/** Vercel Blob answers `?download=1` with an attachment. */
export function forcedDownloadUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set("download", "1");
  return parsed.toString();
}

/**
 * How a file opens from its row. Every file opens: images and documents in
 * their viewers, video and audio in a player, and anything else in a dialog
 * with its name, size and a Download button.
 */
export function DriveFilePreview({
  name,
  fileUrl,
  sizeBytes,
  detailsHref,
  children,
}: DriveFilePreviewProps): ReactElement {
  const { isImage, isVideo, isAudio, documentKind } = classifyFilePreview(
    fileUrl,
    name,
  );
  const [openImageSrc, setOpenImageSrc] = useState<string | null>(null);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);
  const [isMediaDialogOpen, setIsMediaDialogOpen] = useState(false);

  function activate() {
    if (isImage) {
      setOpenImageSrc(fileUrl);
    } else if (documentKind) {
      setIsDocumentViewerOpen(true);
    } else {
      setIsMediaDialogOpen(true);
    }
  }

  return (
    <>
      {children({
        activate,
        nameEl: <DriveItemName name={name} />,
        viewers: (
          <>
            {isImage ? (
              <ImageViewer
                images={[{ src: fileUrl, alt: name, downloadFilename: name }]}
                activeSrc={openImageSrc}
                onActiveSrcChange={setOpenImageSrc}
              />
            ) : null}
            {documentKind ? (
              <DocumentViewer
                open={isDocumentViewerOpen}
                onOpenChange={setIsDocumentViewerOpen}
                url={fileUrl}
                fileName={name}
                kind={documentKind}
              />
            ) : null}
            {isMediaDialogOpen ? (
              <FileMediaDialog
                fileName={name}
                sizeBytes={sizeBytes}
                url={fileUrl}
                downloadUrl={forcedDownloadUrl(fileUrl)}
                detailsHref={detailsHref}
                media={isVideo ? "video" : isAudio ? "audio" : null}
                onClose={() => setIsMediaDialogOpen(false)}
              />
            ) : null}
          </>
        ),
      })}
    </>
  );
}
