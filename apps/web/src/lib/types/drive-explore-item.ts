import type { DriveItem } from "@/lib/clients/generated/core";

/**
 * Union of all Drive exploration items: blob files/folders + virtual Tasks tree.
 * Tasks rows are not blob folders — they are views over Core task files.
 */
export type DriveExploreItem =
  | BlobFolderItem
  | BlobFileItem
  | TasksRootItem
  | TaskProjectItem
  | TaskNoProjectItem
  | TaskItem
  | TaskFileItem;

/**
 * Regular Drive folder (blob prefix)
 */
export interface BlobFolderItem {
  type: "blob-folder";
  name: string;
  path: string;
}

/**
 * Regular Drive file (blob storage)
 */
export interface BlobFileItem {
  type: "blob-file";
  name: string;
  pathname: string;
  fileUrl: string;
  size: number;
  uploadedAt: Date;
}

/**
 * Virtual Tasks folder root (prepended at Drive root)
 */
export interface TasksRootItem {
  type: "tasks-root";
}

/**
 * Project row in Tasks view (has at least one task file)
 */
export interface TaskProjectItem {
  type: "task-project";
  id: string;
  name: string;
  latestFileUpdatedAt: string;
}

/**
 * No-project row for unscoped tasks with files
 */
export interface TaskNoProjectItem {
  type: "task-no-project";
  id: "null";
  latestFileUpdatedAt: string;
}

/**
 * Task row in Tasks view (has at least one file)
 */
export interface TaskItem {
  type: "task";
  id: string;
  name: string;
  latestFileUpdatedAt: string;
}

/**
 * TaskFile row in Tasks view
 */
export interface TaskFileItem {
  type: "task-file";
  id: string;
  name: string;
  fileUrl: string;
  size: number | null;
  mimeType: string | null;
  updatedAt: string;
}

/**
 * Convert Core DriveItem (blob file/folder) to explore item
 */
export function driveItemToExploreItem(item: DriveItem): DriveExploreItem {
  if (item.type === "folder") {
    return {
      type: "blob-folder",
      name: item.name,
      path: item.name,
    };
  }
  return {
    type: "blob-file",
    name: item.name,
    pathname: item.pathname,
    fileUrl: item.fileUrl,
    size: item.size,
    uploadedAt: item.uploadedAt,
  };
}
