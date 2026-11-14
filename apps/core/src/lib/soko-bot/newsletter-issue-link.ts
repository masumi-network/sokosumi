/** The authorized newsletter issue editor, shared by tool feedback and receipts. */
export function newsletterIssueLink(
  issue: { id: string; projectId: string },
  draftedBySokoBot = false,
): string {
  return `/newsletter/issues/${encodeURIComponent(issue.id)}?projectId=${encodeURIComponent(issue.projectId)}${draftedBySokoBot ? "&draftedBySokoBot=true" : ""}`;
}
