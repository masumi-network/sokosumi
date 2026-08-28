"use client";

import type { MouseEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { useState } from "react";

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

function stopCardActivation(event: MouseEvent | PointerEvent) {
  event.stopPropagation();
}

interface DriveItemCardProps {
  viewMode: FilesViewMode;
  activateLabel?: string;
  onActivate?: () => void;
  actions?: ReactNode;
  children: ReactNode;
}

export function DriveItemCard({
  viewMode,
  activateLabel,
  onActivate,
  actions,
  children,
}: DriveItemCardProps): ReactElement {
  return (
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
          onActivate ? "pointer-events-none" : undefined,
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
  );
}

export function DriveItemName({
  name,
  className,
}: {
  name: string;
  className?: string;
}): ReactElement {
  return (
    <span className={cn(driveItemNameClass(), className)} title={name}>
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
  isImage: boolean;
  documentKind: "office" | "pdf" | "text" | null;
  children: (api: DriveFilePreviewApi) => ReactNode;
}

export function DriveFilePreview({
  name,
  fileUrl,
  isImage,
  documentKind,
  children,
}: DriveFilePreviewProps): ReactElement {
  const isPreviewable = isImage || documentKind !== null;
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);
  const [isDocumentViewerOpen, setIsDocumentViewerOpen] = useState(false);

  function activate() {
    if (isImage) {
      setIsImageViewerOpen(true);
    } else if (documentKind) {
      setIsDocumentViewerOpen(true);
    }
  }

  return (
    <>
      {children({
        activate: isPreviewable ? activate : undefined,
        nameEl: <DriveItemName name={name} />,
        viewers: (
          <>
            {isImage ? (
              <ImageViewer
                open={isImageViewerOpen}
                onOpenChange={setIsImageViewerOpen}
                src={fileUrl}
                alt={name}
                downloadFilename={name}
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
          </>
        ),
      })}
    </>
  );
}
