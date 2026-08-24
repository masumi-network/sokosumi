import { FileIcon } from "lucide-react";
import { FileChipWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
import { TaskFileStatusBadge } from "@/components/tasks/task-file-status-badge";
import type {
  PublicSharedTaskFile,
  TaskFile,
  TaskFileStatus,
} from "@/lib/clients/generated/core";

export type TaskFileListItem =
  | Pick<TaskFile, "id" | "name" | "fileUrl" | "size" | "mimeType" | "status">
  | PublicSharedTaskFile;

interface TaskFilesProps {
  title: string;
  files: TaskFileListItem[];
  className?: string;
}

function hasStatus(file: TaskFileListItem): file is TaskFile {
  return "status" in file;
}

/**
 * Read-only list of task files. Shows PENDING/FAILED with status badges, READY with clickable chips. Hidden when empty.
 */
export function TaskFiles({ title, files, className }: TaskFilesProps) {
  if (files.length === 0) {
    return null;
  }

  return (
    <section className={className}>
      <h2 className="text-muted-foreground mb-3 text-xs font-semibold tracking-wider uppercase">
        {title}
      </h2>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-2">
        {files.map((file) =>
          file.fileUrl && hasStatus(file) && file.status === "READY" ? (
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
              <span className="text-foreground/80 w-full truncate text-sm">
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
    </section>
  );
}
