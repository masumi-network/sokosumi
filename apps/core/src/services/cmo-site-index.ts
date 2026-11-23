import { z } from "zod";

/** The site's documentation under "Brand research": one note and two shots per page. */
export const CMO_SITE_INDEX = "Site/pages.json";
/** The same folder as a Drive path. */
export const CMO_BRAND_SITE_FOLDER = "Brand research/Site";

export const cmoSitePageSchema = z.object({
  url: z.string(),
  title: z.string(),
  /** One plain line: what the page offers and to whom. */
  summary: z.string(),
  /** Prices, features, proof and audience the page states, word for word where it can. */
  facts: z.array(z.string()),
  /** The files' name under Site: `<name>.jpg`, `<name>-mobile.jpg`, `<name>.md`. */
  name: z.string(),
  readAt: z.string(),
  /** The page's files: its desktop and phone shots and its note (read_file). */
  desktopFileId: z.string().nullable().default(null),
  phoneFileId: z.string().nullable().default(null),
  noteFileId: z.string().nullable().default(null),
});
export type CmoSitePage = z.infer<typeof cmoSitePageSchema>;

export const cmoSiteIndexSchema = z.object({
  /** When this reading of the site began; a new month starts another. */
  startedAt: z.string(),
  /** Addresses still to read, in order. */
  queue: z.array(z.string()),
  pages: z.array(cmoSitePageSchema),
});
export type CmoSiteIndex = z.infer<typeof cmoSiteIndexSchema>;
