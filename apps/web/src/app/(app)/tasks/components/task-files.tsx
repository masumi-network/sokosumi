import { FileChipMiniPreviewWithMetadata } from "@/components/jobs/job-details/file-chip-with-metadata";
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
      <div className="flex flex-wrap gap-3">
        {files.map((file) =>
          file.fileUrl ? (
            <div key={file.id} className="flex items-center gap-2">
              <FileChipMiniPreviewWithMetadata
                url={file.fileUrl}
                fileName={file.name}
                mediaType={file.mimeType}
              />
              {hasStatus(file) && (
                <TaskFileStatusBadge status={file.status as TaskFileStatus} />
              )}
            </div>
          ) : (
            <div
              key={file.id}
              className="flex items-center gap-2 rounded-md border p-1.5"
            >
              <span className="flex-1 truncate text-xs">{file.name}</span>
              {hasStatus(file) && (
                <TaskFileStatusBadge status={file.status as TaskFileStatus} />
              )}
            </div>
          ),
        )}
      </div>
    </section>
  );
}
