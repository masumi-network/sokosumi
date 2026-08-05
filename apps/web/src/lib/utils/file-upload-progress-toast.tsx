"use client";

import { toast } from "sonner";

import { Progress } from "@/components/ui/progress";
import { formatBytes } from "@/lib/utils/format-bytes";

interface FileUploadProgressToastItem {
  id: string;
  name: string;
  total: number;
  loaded: number;
  percentage: number;
}

export interface FileUploadProgressToastLabels {
  uploadingFile: string;
  uploadingFiles: string;
}

export interface FileUploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface FileUploadProgressToastController {
  updateFileProgress: (fileIndex: number, progress: FileUploadProgress) => void;
  markFileComplete: (fileIndex: number) => void;
  dismiss: () => void;
}

interface FileUploadProgressToastContentProps {
  title: string;
  items: FileUploadProgressToastItem[];
  totalLoaded: number;
  totalBytes: number;
  totalPercentage: number;
}

interface CreateFileUploadProgressToastOptions {
  files: File[];
  labels: FileUploadProgressToastLabels;
}

const FILE_UPLOAD_PROGRESS_TOAST_CLASS_NAMES = {
  toast: "!pointer-events-none !touch-auto",
  content: "pointer-events-none",
  title: "pointer-events-none",
} as const;

function formatTemplate(
  template: string,
  values: Record<string, number | string>,
): string {
  let result = template;

  for (const [key, value] of Object.entries(values)) {
    result = result.replaceAll(`{${key}}`, String(value));
  }

  return result;
}

function clampPercentage(percentage: number): number {
  return Math.max(0, Math.min(percentage, 100));
}

function clampLoadedBytes(loaded: number, total: number): number {
  return Math.max(0, Math.min(loaded, total));
}

function getAggregateTotalBytes(items: FileUploadProgressToastItem[]): number {
  return items.reduce((sum, item) => sum + item.total, 0);
}

function getAggregateLoadedBytes(items: FileUploadProgressToastItem[]): number {
  return items.reduce((sum, item) => sum + item.loaded, 0);
}

function updateToastItem(
  items: FileUploadProgressToastItem[],
  itemIndex: number,
  updater: (item: FileUploadProgressToastItem) => FileUploadProgressToastItem,
): FileUploadProgressToastItem[] | null {
  const item = items[itemIndex];
  if (!item) {
    return null;
  }

  return items.map((currentItem, index) =>
    index === itemIndex ? updater(currentItem) : currentItem,
  );
}

function createToastId(): string {
  return `file-upload-progress-${Date.now()}-${Math.round(
    Math.random() * 1_000_000,
  )}`;
}

function FileUploadProgressToastContent({
  title,
  items,
  totalLoaded,
  totalBytes,
  totalPercentage,
}: FileUploadProgressToastContentProps) {
  return (
    <div className="pointer-events-none flex min-w-80 max-w-sm flex-col gap-3 rounded-lg border border-border bg-card-background p-4 text-foreground shadow-lg">
      <div className="space-y-1">
        <div className="font-medium text-sm">{title}</div>
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            {formatBytes(totalLoaded)} / {formatBytes(totalBytes)}
          </span>
          <span className="tabular-nums">
            {Math.round(totalPercentage).toString()}%
          </span>
        </div>
      </div>

      <Progress value={totalPercentage} aria-label={title} />

      <div className="pointer-events-auto max-h-32 space-y-2 overflow-y-auto overscroll-contain pr-1 touch-pan-y">
        {items.map((item) => (
          <div key={item.id} className="space-y-1">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-medium">{item.name}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">
                {Math.round(item.percentage).toString()}%
              </span>
            </div>
            <div className="text-muted-foreground text-[0.6875rem]">
              {formatBytes(item.loaded)} / {formatBytes(item.total)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function createFileUploadProgressToast({
  files,
  labels,
}: CreateFileUploadProgressToastOptions): FileUploadProgressToastController {
  const toastId = createToastId();
  // Keep items immutable so React Compiler sees each per-file update.
  let items: FileUploadProgressToastItem[] = files.map((file, index) => ({
    id: `${index}-${file.name}-${file.size}`,
    name: file.name,
    total: file.size,
    loaded: 0,
    percentage: 0,
  }));

  function syncToast() {
    const totalBytes = getAggregateTotalBytes(items);
    const totalLoaded = clampLoadedBytes(
      getAggregateLoadedBytes(items),
      totalBytes,
    );
    const totalPercentage =
      totalBytes > 0 ? clampPercentage((totalLoaded / totalBytes) * 100) : 0;
    const title =
      items.length === 1
        ? formatTemplate(labels.uploadingFile, {
            fileName: items[0]?.name ?? "",
          })
        : formatTemplate(labels.uploadingFiles, { count: items.length });

    toast.custom(
      () => (
        <FileUploadProgressToastContent
          title={title}
          items={items}
          totalLoaded={totalLoaded}
          totalBytes={totalBytes}
          totalPercentage={totalPercentage}
        />
      ),
      {
        id: toastId,
        duration: Infinity,
        dismissible: false,
        classNames: FILE_UPLOAD_PROGRESS_TOAST_CLASS_NAMES,
      },
    );
  }

  syncToast();

  return {
    updateFileProgress(fileIndex, progress) {
      const nextItems = updateToastItem(items, fileIndex, (item) => {
        const nextTotal = progress.total > 0 ? progress.total : item.total;

        return {
          ...item,
          total: nextTotal,
          loaded: clampLoadedBytes(progress.loaded, nextTotal),
          percentage: clampPercentage(progress.percentage),
        };
      });
      if (!nextItems) {
        return;
      }

      items = nextItems;
      syncToast();
    },
    markFileComplete(fileIndex) {
      const nextItems = updateToastItem(items, fileIndex, (item) => ({
        ...item,
        loaded: item.total,
        percentage: 100,
      }));
      if (!nextItems) {
        return;
      }

      items = nextItems;
      syncToast();
    },
    dismiss() {
      toast.dismiss(toastId);
    },
  };
}
