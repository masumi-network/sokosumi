/**
 * Every colour used by an email lives here.
 *
 * Values mirror the product tokens in `apps/web/src/app/globals.css`. The
 * source token is named next to each value so a later brand change has one
 * traceable path from the app to the inbox.
 */

export interface EmailPalette {
  /** Brand stripe down the card's leading edge. */
  accent: string;
  /** Text drawn on top of `accentSolid`. */
  accentForeground: string;
  /** Filled button background. */
  accentSolid: string;
  /** Border around the email card. */
  cardBorder: string;
  /** Divider lines inside the card. */
  hairline: string;
  /** Anchor colour for the copy-and-paste fallback URL. */
  link: string;
  /** Page background behind the card. */
  pageBackground: string;
  /** Left bar on a quoted message. */
  quoteBar: string;
  /** Email card background. */
  surface: string;
  /** Tinted panel: quote, fallback URL, field card. */
  surfaceSubtle: string;
  /** Headings and body copy. */
  textPrimary: string;
  /** Secondary copy: footer, labels, field names. */
  textMuted: string;
}

/**
 * Light palette. Default for every client.
 *
 * Iris Flower (`--primary`) is a fill under a Neutral 950 label, never text,
 * an edge or a thin mark, so it only fills the button. The spine, quote bar and
 * link take the neutral roles the app uses for the same jobs.
 */
export const LIGHT_PALETTE: EmailPalette = {
  accent: "#0c0c0c", // --secondary
  accentForeground: "#0c0c0c", // --primary-foreground
  accentSolid: "#ff51ff", // --primary
  cardBorder: "#e5e5e5", // --border
  hairline: "#e5e5e5", // --border
  link: "#171717", // --foreground, as the app's link variant
  pageBackground: "#f5f5f5", // --muted
  quoteBar: "#d4d4d4", // --control-border
  surface: "#ffffff", // --background
  surfaceSubtle: "#f5f5f5", // --card-background
  textPrimary: "#171717", // --foreground
  textMuted: "#525252", // --muted-foreground
};

/** Dark palette. Applied through `prefers-color-scheme` where the client supports it. */
export const DARK_PALETTE: EmailPalette = {
  accent: "#fafafa", // dark --secondary
  accentForeground: "#0c0c0c", // dark --primary-foreground
  accentSolid: "#d141d1", // dark --primary (Dark Iris)
  cardBorder: "#262626", // dark --border
  hairline: "#262626", // dark --border
  link: "#fafafa", // dark --foreground
  pageBackground: "#0c0c0c", // dark --background
  quoteBar: "#404040", // dark --control-border
  surface: "#171717", // dark --card-background
  surfaceSubtle: "#262626", // dark --accent
  textPrimary: "#fafafa", // dark --foreground
  textMuted: "#a3a3a3", // dark --muted-foreground
};
