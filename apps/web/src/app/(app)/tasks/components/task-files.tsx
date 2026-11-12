"use client";

import type {
  PublicSharedTaskFile,
  TaskFile,
  TaskFileStatus,
} from "@sokosumi/core-client";
import { DownloadIcon, FileIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  createTaskFilesArchive,
  safeFileName,
  type TaskArchiveFile,
} from "@/app/tasks/utils/task-files-archive";
import { FileChipWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { TaskFileStatusBadge } from "@/components/tasks/task-file-status-badge";
import { Button } from "@/components/ui/button";

export type TaskFileListItem =
  | Pick<TaskFile, "id" | "name" | "fileUrl" | "size" | "mimeType" | "status">
  | PublicSharedTaskFile;

interface TaskFilesProps {
  taskId: string;
  title: string;
  expandLabel: string;
  collapseLabel: string;
  files: TaskFileListItem[];
  /** Zip name without extension; set it to offer "Download all" when two or more files are ready. */
  downloadAllName?: string;
  className?: string;
}

const LISTED_MISSING_NAMES = 5;

function hasStatus(file: TaskFileListItem): file is TaskFile {
  return "status" in file;
}

function isFileReady(file: TaskFileListItem): boolean {
  if (hasStatus(file)) {
    return file.status === "READY";
  }
  // PublicSharedTaskFile has no status; treat as ready when fileUrl exists
  return !!file.fileUrl;
}

/**
 * Read-only list of task files. Shows PENDING/FAILED with status badges, READY with clickable chips. Hidden when empty.
 */
export function TaskFiles(props: TaskFilesProps) {
  return <TaskFilesContent key={props.taskId} {...props} />;
}

function TaskFilesContent({
  title,
  files,
  expandLabel,
  collapseLabel,
  downloadAllName,
  className,
}: TaskFilesProps) {
  const [expanded, setExpanded] = useState(false);
  // Next retains inactive routes in Activity; reset when hidden, not on refresh.
  useLayoutEffect(() => {
    return () => setExpanded(false);
  }, []);
  const contentId = useId();
  const isExpandable = files.length > 3;
  const visibleFiles = expanded ? files : files.slice(0, 3);
  const readyFiles = files.flatMap((file) =>
    file.fileUrl && isFileReady(file)
      ? [{ name: file.name, fileUrl: file.fileUrl }]
      : [],
  );
  if (files.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-muted-foreground text-xs font-semibold">{title}</h2>
        {downloadAllName !== undefined && readyFiles.length > 1 ? (
          <DownloadAllButton name={downloadAllName} files={readyFiles} />
        ) : null}
      </div>
      <div
        id={contentId}
        className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2"
      >
        {visibleFiles.map((file) =>
          file.fileUrl && isFileReady(file) ? (
            <FileChipWithMetadata
              key={file.id}
              url={file.fileUrl}
              fileName={file.name}
              mediaType={file.mimeType}
              size={file.size}
              sizeClass="size-4"
              variant="single-line"
            />
          ) : (
            <div
              key={file.id}
              className="inline-flex items-center gap-2 rounded-md border p-2"
            >
              <div className="inline-flex items-center justify-center">
                <FileIcon className="text-muted-foreground size-4" />
              </div>
              <span className="text-foreground w-full truncate text-sm">
                {file.name}
              </span>
              {hasStatus(file) && (
                <div className="inline-flex justify-end">
                  <TaskFileStatusBadge status={file.status as TaskFileStatus} />
                </div>
              )}
            </div>
          ),
        )}
      </div>
      {isExpandable ? (
        <div className="mt-2 flex justify-center">
          <Button
            type="button"
            variant="outline"
            className="h-7 rounded-full px-3 text-xs font-semibold"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? collapseLabel : expandLabel}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

interface DownloadAllButtonProps {
  name: string;
  files: TaskArchiveFile[];
}

function DownloadAllButton({ name, files }: DownloadAllButtonProps) {
  const t = useTranslations("App.Tasks.Detail.downloadAll");
  const [downloading, setDownloading] = useState(false);
  const downloadAbort = useRef<AbortController | null>(null);
  // Next keeps a left Task page in Activity: its effects clean up but its
  // state stays, so a running download is cancelled and the button freed.
  useEffect(
    () => () => {
      downloadAbort.current?.abort();
      downloadAbort.current = null;
      setDownloading(false);
    },
    [],
  );

  async function handleDownloadAll() {
    const controller = new AbortController();
    downloadAbort.current = controller;
    setDownloading(true);
    try {
      const archive = await createTaskFilesArchive(files, controller.signal);
      // Cancelled while the zip was being made: no file and no toast.
      if (controller.signal.aborted) return;
      if (!archive.data) {
        toast.error(t("failed"));
        return;
      }
      const url = URL.createObjectURL(
        new Blob([archive.data], { type: "application/zip" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${safeFileName(name, "files")}.zip`;
      link.click();
      // Allow the browser to begin saving before releasing the blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      if (archive.missing.length > 0) {
        toast.warning(
          t("partial", {
            included: archive.included.length,
            total: files.length,
            names: archive.missing.slice(0, LISTED_MISSING_NAMES).join(", "),
            more: Math.max(0, archive.missing.length - LISTED_MISSING_NAMES),
          }),
          { duration: 15_000 },
        );
      }
    } catch {
      if (!controller.signal.aborted) toast.error(t("failed"));
    } finally {
      if (downloadAbort.current === controller) {
        downloadAbort.current = null;
        setDownloading(false);
      }
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="h-7 rounded-full px-3 text-xs font-semibold"
      loading={downloading}
      onClick={handleDownloadAll}
    >
      <DownloadIcon className="size-3.5" aria-hidden />
      {t("button")}
    </Button>
  );
}
