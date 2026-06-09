export function buildDesignMdPreviewUrl(
  previewBaseUrl: string,
  extractionId: string | number,
): string {
  const url = new URL("/tools/design-md", previewBaseUrl);
  url.searchParams.set("cached", String(extractionId));
  return url.toString();
}
