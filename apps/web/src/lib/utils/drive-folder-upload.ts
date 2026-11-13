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

export interface DriveFolderUploadPlan {
  /** Top folder the upload creates, e.g. `Projects/Launch`. */
  rootFolder: string;
  uploads: DriveFolderUploadItem[];
  skipped: { path: string; reason: DriveFolderUploadSkipReason }[];
}

/**
 * Turn the files of a `webkitdirectory` pick into one upload per file,
 * each into its subfolder under `baseFolder`.
 *
 * Files folders are paths, so uploading `a/b/c.txt` into `a/b` creates both
 * folders, and an existing folder of the same name is merged into. Hidden
 * files (`.DS_Store`, anything under `.git/`) and files Core would refuse
 * (type, size) are skipped up front instead of failing one by one.
 */
export function planDriveFolderUpload(
  files: readonly File[],
  baseFolder: string,
): DriveFolderUploadPlan {
  const plan: DriveFolderUploadPlan = {
    rootFolder: "",
    uploads: [],
    skipped: [],
  };
  const base = baseFolder.split("/").filter(Boolean);

  for (const file of files) {
    const path = file.webkitRelativePath || file.name;
    const segments = path.split("/").filter(Boolean);
    if (!plan.rootFolder && segments.length > 1) {
      plan.rootFolder = [...base, segments[0]].join("/");
    }

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
