"use client";

import { FileIcon } from "lucide-react";
import { useId, useLayoutEffect, useState } from "react";
import { FileChipWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { TaskFileStatusBadge } from "@/components/tasks/task-file-status-badge";
import { Button } from "@/components/ui/button";
import type {
  PublicSharedTaskFile,
  TaskFile,
  TaskFileStatus,
} from "@/lib/clients/generated/core";

export type TaskFileListItem =
  | Pick<TaskFile, "id" | "name" | "fileUrl" | "size" | "mimeType" | "status">
  | PublicSharedTaskFile;

interface TaskFilesProps {
  taskId: string;
  title: string;
  expandLabel: string;
  collapseLabel: string;
  files: TaskFileListItem[];
  className?: string;
}

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
  if (files.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <h2 className="text-muted-foreground mb-3 text-xs font-semibold">
        {title}
      </h2>
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
