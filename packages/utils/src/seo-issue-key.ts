function pageKey(value: string): string {
  const url = new URL(value);
  url.hash = "";
  return url.href;
}

/** One issue per rule and page in a check, across all its devices. */
export function seoIssueKey(finding: {
  observationId: string;
  rowId: string;
  pageUrl: string;
  relatedPageUrl?: string | null;
}): string {
  return JSON.stringify([
    finding.observationId,
    finding.rowId,
    pageKey(finding.pageUrl),
    finding.relatedPageUrl ? pageKey(finding.relatedPageUrl) : null,
  ]);
}
