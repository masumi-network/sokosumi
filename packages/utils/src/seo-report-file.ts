/** Formats delivered by the SEO worker, including JSON files from older audits. */
export function seoReportFileFormat(
  taskId: string,
  name: string,
  mimeType: string | null,
): "pdf" | "markdown" | "json" | null {
  const base = `seo-report-${taskId}`;
  if (mimeType === "application/pdf" && name === `${base}.pdf`) return "pdf";
  if (mimeType === "text/markdown" && name === `${base}.md`) return "markdown";
  if (
    mimeType === "application/json" &&
    (name === `${base}.data.json` || name === `${base}.json`)
  )
    return "json";
  return null;
}
