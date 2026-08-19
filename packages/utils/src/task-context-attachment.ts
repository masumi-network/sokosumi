import { DESIGN_MD_ATTACHMENT_LABEL } from "./design-md-attachment.js";
import { replaceMarkdownLinks } from "./markdown-links.js";

export const PROJECT_BRIEFING_ATTACHMENT_LABEL = "BRIEFING.md";
export const PROJECT_CONTEXT_MD_ATTACHMENT_LABEL = "CONTEXT.md";

/** Labels of the context files Sokosumi prepends to task descriptions. */
const TASK_CONTEXT_ATTACHMENT_LABELS: ReadonlySet<string> = new Set([
  DESIGN_MD_ATTACHMENT_LABEL,
  PROJECT_BRIEFING_ATTACHMENT_LABEL,
  PROJECT_CONTEXT_MD_ATTACHMENT_LABEL,
]);

/**
 * Strips DESIGN.md, BRIEFING.md and CONTEXT.md attachment links so the
 * remaining markdown is what the user actually wrote — for naming, summaries
 * and prompts.
 */
export function removeTaskContextAttachmentLinks(markdown: string): string {
  const withoutLinks = replaceMarkdownLinks(markdown, (match) =>
    TASK_CONTEXT_ATTACHMENT_LABELS.has(match.text) ? "" : match.match,
  );

  return withoutLinks.replace(/\n{3,}/g, "\n\n").trim();
}
