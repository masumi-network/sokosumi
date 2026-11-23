/** "Subject: …", also as "**Subject:** …" or "# Subject: …". */
const LABELED_LINE =
  /^[#*\s]*(?:subject(?: line)?|headline|title)\**\s*:\s*\**\s*(.+?)\**\s*$/im;

/** "Subject: Launch day" → "Launch day"; other text as it is. */
export function withoutLabel(value: string): string {
  return LABELED_LINE.exec(value)?.[1]?.trim() ?? value;
}
