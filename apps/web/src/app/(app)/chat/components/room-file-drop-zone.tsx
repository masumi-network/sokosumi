"use client";

import {
  type DragEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";

function dataTransferHasFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

/**
 * Room-shell file drop target: message list + composer (or draft/thread pane).
 * Shows a light overlay while dragging files. Non-file drags are ignored.
 */
export function RoomFileDropZone({
  enabled,
  onFiles,
  label,
  children,
  className,
}: {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragDepthRef = useRef(0);

  const resetDrag = useCallback(() => {
    dragDepthRef.current = 0;
    setIsDraggingFiles(false);
  }, []);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDraggingFiles(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDraggingFiles(false);
    }
  }, []);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!dataTransferHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      event.stopPropagation();
      resetDrag();
      const files = Array.from(event.dataTransfer.files).filter(
        (file) => file.size > 0,
      );
      if (files.length === 0) return;
      onFiles(files);
    },
    [onFiles, resetDrag],
  );

  if (!enabled) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      className={cn("relative", className)}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {isDraggingFiles ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-accent/50"
        >
          <p className="bg-background text-foreground rounded-md border px-4 py-2 text-sm font-medium shadow-sm">
            {label}
          </p>
        </div>
      ) : null}
    </div>
  );
}
