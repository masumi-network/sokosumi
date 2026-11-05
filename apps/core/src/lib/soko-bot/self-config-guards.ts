import {
  normalizeDriveFolderPath,
  validateDriveFolderPath,
} from "@sokosumi/utils";
import { DRIVE_VIRTUAL_TASKS_FOLDER_NAME } from "@/helpers/drive-folder-reserved-names";

/** A Drive folder a bot may write into, normalized; "" is the top level. */
export function sokoBotDriveFolder(
  folder: string | undefined,
): { folder: string } | { refusal: string } {
  const normalized = normalizeDriveFolderPath(folder ?? "");
  const invalid = validateDriveFolderPath(normalized);
  if (invalid) return { refusal: invalid };
  if (normalized.split("/")[0] === DRIVE_VIRTUAL_TASKS_FOLDER_NAME)
    return {
      refusal: `"${DRIVE_VIRTUAL_TASKS_FOLDER_NAME}" is reserved for task files; choose another folder`,
    };
  return { folder: normalized };
}

/**
 * Why a bot may not change its skills in this turn, or null. A skill is
 * third-party instructions the bot follows on every later turn, so only the
 * owner's own request in their own chat may change them.
 */
export function skillChangeRefusal(turn: {
  source: string | null;
  chainDepth: number;
  askedByAssistant: boolean;
  shared: boolean;
}): string | null {
  if (turn.shared)
    return "A shared assistant's skills are set by its owner on the Soko Bot page";
  if (turn.source !== "CHAT" || turn.chainDepth > 0 || turn.askedByAssistant)
    return "Skills change only when your owner asks for it in their chat. Suggest the skill to them instead.";
  return null;
}
