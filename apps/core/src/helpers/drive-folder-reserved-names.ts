import { conflict } from "@/helpers/error";

export const DRIVE_VIRTUAL_TASKS_FOLDER_NAME = "Sokosumi Projects";

/**
 * Only new paths are checked (create, rename target, move target). A folder
 * already named "Sokosumi Projects" keeps its files and stays listed beside the
 * virtual folder; it can be renamed or deleted, nothing new goes in or under it.
 */
export function assertDriveFolderPathNotReserved(folderPath: string): void {
  const rootSegment = folderPath.split("/")[0];
  if (rootSegment === DRIVE_VIRTUAL_TASKS_FOLDER_NAME) {
    throw conflict(
      `Folder name '${DRIVE_VIRTUAL_TASKS_FOLDER_NAME}' is reserved for the virtual ${DRIVE_VIRTUAL_TASKS_FOLDER_NAME} folder`,
    );
  }
}

export function resolveMovedFolderPath(
  targetFolderPath: string,
  folderName: string,
): string {
  return targetFolderPath ? `${targetFolderPath}/${folderName}` : folderName;
}
