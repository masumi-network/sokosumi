import { conflict } from "@/helpers/error";

export const DRIVE_VIRTUAL_TASKS_FOLDER_NAME = "Tasks";

export function assertDriveFolderPathNotReserved(folderPath: string): void {
  const rootSegment = folderPath.split("/")[0];
  if (rootSegment === DRIVE_VIRTUAL_TASKS_FOLDER_NAME) {
    throw conflict(
      "Folder name 'Tasks' is reserved for the virtual Tasks folder",
    );
  }
}

export function resolveMovedFolderPath(
  targetFolderPath: string,
  folderName: string,
): string {
  return targetFolderPath ? `${targetFolderPath}/${folderName}` : folderName;
}
