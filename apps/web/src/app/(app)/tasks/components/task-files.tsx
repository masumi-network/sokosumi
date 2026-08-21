import { FileChip } from "@/components/ui/file-chip";
import type {
  PublicSharedTaskFile,
  TaskFile,
} from "@/lib/clients/generated/core";

export type TaskFileListItem = Pick<
  TaskFile | PublicSharedTaskFile,
  "id" | "name" | "fileUrl" | "size" | "mimeType"
>;

interface TaskFilesProps {
  title: string;
  files: TaskFileListItem[];
  className?: string;
}

/**
 * Read-only list of task file uploads. Hidden when empty.
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
        {files
          .filter(
            (file): file is TaskFileListItem & { fileUrl: string } =>
              file.fileUrl !== null,
          )
          .map((file) => (
            <FileChip
              key={file.id}
              url={file.fileUrl}
              fileName={file.name}
              mediaType={file.mimeType}
              size={file.size}
            />
          ))}
      </div>
    </section>
  );
}
