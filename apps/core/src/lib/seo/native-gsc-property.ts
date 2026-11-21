import { z } from "@hono/zod-openapi";
import { seoSearchUrlPrefixCovers } from "@sokosumi/utils";

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
  return seoSearchUrlPrefixCovers(property, urls);
}

const sitesSchema = z.object({
  siteEntry: z
    .array(
      z.object({
        siteUrl: z.string().max(500),
        permissionLevel: z.string().nullish(),
      }),
    )
    .max(1000)
    .default([]),
});

export function readableGscProperties(
  payload: Record<string, unknown>,
): string[] {
  if (
    !("siteEntry" in payload) &&
    Object.keys(payload).some((key) => key !== "kind")
  )
    throw new Error("Search Console returned an unsupported property list");
  return [
    ...new Set(
      sitesSchema
        .parse(payload)
        .siteEntry.filter(
          ({ permissionLevel }) =>
            permissionLevel === "siteOwner" ||
            permissionLevel === "siteFullUser" ||
            permissionLevel === "siteRestrictedUser",
        )
        .map(({ siteUrl }) => siteUrl),
    ),
  ];
}
