/** A URL-prefix or domain property must cover every exact page being inspected. */
export function gscPropertyCovers(property: string, urls: string[]): boolean {
  if (property.startsWith("sc-domain:")) {
    const domain = property.slice("sc-domain:".length).toLowerCase();
    return (
      !!domain &&
      urls.every((url) => {
        const host = new URL(url).hostname.toLowerCase();
        return host === domain || host.endsWith(`.${domain}`);
      })
    );
  }
  if (!URL.canParse(property)) return false;
  const prefix = new URL(property);
  return (
    ["https:", "http:"].includes(prefix.protocol) &&
    !prefix.username &&
    !prefix.password &&
    urls.every(
      (url) =>
        new URL(url).origin === prefix.origin && url.startsWith(prefix.href),
    )
  );
}
