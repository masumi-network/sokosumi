export const day = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

export const count = (value: number) => value.toLocaleString("en-US");

export const NOT_KNOWN = "Not known";

export function pagePath(url: string | null): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  } catch {
    return url;
  }
}
