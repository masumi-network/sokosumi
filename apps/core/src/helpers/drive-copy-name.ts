import { randomBytes } from "node:crypto";

import { DRIVE_FILE_MAX_NAME_LENGTH } from "@sokosumi/utils";

/**
 * One Drive name per copy attempt: `weekly (copy).md` becomes
 * `weekly (copy) 3f9a1c07be.md`. The id is 40 random bits minted here, so
 * until the attempt's own bytes land nobody else can address its key: no
 * upload, rename or move can target a name it does not know. A long name is
 * trimmed before its label, by whole code points, never the label, the id
 * or the extension.
 */
export function copyAttemptName(filename: string): string {
  const id = randomBytes(5).toString("hex");
  const dot = filename.lastIndexOf(".");
  const extension = dot > 0 ? filename.slice(dot) : "";
  const stem = dot > 0 ? filename.slice(0, dot) : filename;
  const labelAt = stem.lastIndexOf(" (");
  const label = labelAt > 0 ? stem.slice(labelAt) : "";
  const head = labelAt > 0 ? stem.slice(0, labelAt) : stem;
  let room =
    DRIVE_FILE_MAX_NAME_LENGTH -
    label.length -
    id.length -
    1 -
    extension.length;
  let kept = "";
  for (const character of head) {
    room -= character.length;
    if (room < 0) break;
    kept += character;
  }
  return `${kept}${label} ${id}${extension}`;
}
