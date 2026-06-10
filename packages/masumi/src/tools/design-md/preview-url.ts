export function buildDesignMdPreviewUrl(
  previewBaseUrl: string,
  extractionId: string | number,
): string {
  const url = new URL("/tools/design-md", previewBaseUrl);
  const isLocalHost = url.hostname === "localhost";
  const isIpv4Address = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);

  if (!url.hostname.startsWith("www.") && !isLocalHost && !isIpv4Address) {
    url.hostname = `www.${url.hostname}`;
  }
  url.searchParams.set("cached", String(extractionId));
  return url.toString();
}
