import { badRequest } from "@/helpers/error";
import type { DriveShareTarget } from "@/services/drive-share.service";

/** The one item a share request names. */
export function driveShareTarget(input: {
  resourceId?: string;
  folderPath?: string;
}): DriveShareTarget {
  if (input.resourceId && input.folderPath === undefined)
    return { kind: "file", resourceId: input.resourceId };
  if (input.folderPath !== undefined && !input.resourceId)
    return { kind: "folder", folderPath: input.folderPath };
  throw badRequest("Give either resourceId or folderPath");
}
