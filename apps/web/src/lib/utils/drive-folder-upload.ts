import {
  FILE_UPLOAD_MAX_SIZE_BYTES,
  resolveUserUploadContentType,
} from "@sokosumi/utils";

/** Most files one folder upload sends; the rest are reported as skipped. */
export const DRIVE_FOLDER_UPLOAD_MAX_FILES = 500;

export type DriveFolderUploadSkipReason = "type" | "size" | "limit";

export interface DriveFolderUploadItem {
  file: File;
  /** Destination folder path, the picked folder's own name included. */
  folder: string;
}

/** A picked or dropped file and its path inside what was picked. */
export interface DriveUploadEntry {
  file: File;
  /** `Launch/assets/logo.png` for a folder, just `logo.png` for a file. */
  path: string;
}

export interface DriveFolderUploadPlan {
  /**
   * The one folder the upload creates, e.g. `Projects/Launch`; empty for
   * loose files or several folders at once.
   */
  rootFolder: string;
  uploads: DriveFolderUploadItem[];
  skipped: { path: string; reason: DriveFolderUploadSkipReason }[];
}

/** Picker files with their folder path (`webkitdirectory` sets it). */
export function driveUploadEntries(files: Iterable<File>): DriveUploadEntry[] {
  return Array.from(files, (file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

/**
 * Every file in a drop, folders read recursively. The entries are taken
 * before the first await, while the browser still exposes them.
 */
export async function driveDropEntries(
  dataTransfer: DataTransfer,
): Promise<DriveUploadEntry[]> {
  const roots = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.webkitGetAsEntry?.() ?? item.getAsFile());
  // No entries API: take the dropped files as they are.
  if (roots.length === 0) return driveUploadEntries(dataTransfer.files ?? []);

  const entries: DriveUploadEntry[] = [];
  async function walk(entry: FileSystemEntry | File | null): Promise<void> {
    if (!entry) return;
    if (entry instanceof File) {
      entries.push({ file: entry, path: entry.name });
    } else if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        (entry as FileSystemFileEntry).file(resolve, reject),
      );
      entries.push({ file, path: entry.fullPath.replace(/^\//, "") });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries hands back one batch per call (100 in Chrome) until empty.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const root of roots) await walk(root);
  return entries;
}

/**
 * Turn picked or dropped files into one upload per file, each into its
 * subfolder under `baseFolder`.
 *
 * Files folders are paths, so uploading `a/b/c.txt` into `a/b` creates both
 * folders, and an existing folder of the same name is merged into. Hidden
 * files (`.DS_Store`, anything under `.git/`) and files Core would refuse
 * (type, size) are skipped up front instead of failing one by one.
 */
export function planDriveFolderUpload(
  entries: readonly DriveUploadEntry[],
  baseFolder: string,
): DriveFolderUploadPlan {
  const plan: DriveFolderUploadPlan = {
    rootFolder: "",
    uploads: [],
    skipped: [],
  };
  const base = baseFolder.split("/").filter(Boolean);
  // One folder picked or dropped: the upload opens it. Anything mixed stays put.
  const tops = new Set(
    entries.map(({ path }) => (path.includes("/") ? path.split("/")[0] : "")),
  );
  const [top] = tops;
  if (tops.size === 1 && top) plan.rootFolder = [...base, top].join("/");

  for (const { file, path } of entries) {
    const segments = path.split("/").filter(Boolean);

    // Hidden files are noise (.DS_Store, .git/); nobody needs them listed.
    if (segments.some((s) => s.startsWith("."))) continue;

    const reason: DriveFolderUploadSkipReason | null =
      !resolveUserUploadContentType(file.name, file.type)
        ? "type"
        : file.size > FILE_UPLOAD_MAX_SIZE_BYTES
          ? "size"
          : plan.uploads.length >= DRIVE_FOLDER_UPLOAD_MAX_FILES
            ? "limit"
            : null;
    if (reason) {
      plan.skipped.push({ path, reason });
      continue;
    }

    plan.uploads.push({
      file,
      folder: [...base, ...segments.slice(0, -1)].join("/"),
    });
  }

  return plan;
}
