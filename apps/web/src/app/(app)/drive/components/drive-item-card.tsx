"use client";

import type { MouseEvent, PointerEvent, ReactElement, ReactNode } from "react";
import { createContext, use, useState } from "react";

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
