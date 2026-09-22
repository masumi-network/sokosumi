/**
 * Every colour used by an email lives here.
 *
 * Values mirror the product tokens in `apps/web/src/app/globals.css`. The
 * source token is named next to each value so a later brand change has one
 * traceable path from the app to the inbox.
 */

export interface EmailPalette {
  /** Brand accent: rules, labels, links. */
  accent: string;
  /** Text drawn on top of `accentSolid`. */
  accentForeground: string;
  /** Filled button background. */
  accentSolid: string;
  /** Border around the email card. */
  cardBorder: string;
  /** Monospace block inside a field card. */
  codeSurface: string;
  /** Divider lines inside the card. */
  hairline: string;
  /** Logo strip behind the header. Stays light so the black logo reads. */
  headerSurface: string;
  /** Strip behind the footer note. */
  footerSurface: string;
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

/** Light palette. Default for every client. */
export const LIGHT_PALETTE: EmailPalette = {
  accent: "#2b5c78", // --primary
  accentForeground: "#fafafa", // --primary-solid-foreground
  accentSolid: "#2b5c78", // --primary-solid
  cardBorder: "#e2e2e2", // --border
  codeSurface: "#ffffff", // --background
  hairline: "#e2e2e2", // --border
  footerSurface: "#fafafa", // --card-background
  headerSurface: "#fafafa", // --card-background
  link: "#2b5c78", // --primary
  pageBackground: "#f5f5f5", // --muted
  quoteBar: "#2b5c78", // --primary
  surface: "#ffffff", // --background
  surfaceSubtle: "#ecf0f3", // --primary-quinary
  textPrimary: "#0a0a0a", // --foreground
  textMuted: "#5c5c5c", // --muted-foreground, darkened to clear WCAG AA on --primary-quinary
};

/** Dark palette. Applied through `prefers-color-scheme` where the client supports it. */
export const DARK_PALETTE: EmailPalette = {
  accent: "#5a9dc4", // dark --primary-variant
  accentForeground: "#fafafa", // dark --primary-solid-foreground
  accentSolid: "#336d8f", // dark --primary-solid
  cardBorder: "#343434", // dark --border
  codeSurface: "#0a0a0a", // dark --background
  hairline: "#343434", // dark --border
  footerSurface: "#171717", // dark --card-background
  headerSurface: "#f2f2f2", // stays light: the only logo asset is black
  link: "#5a9dc4", // dark --primary-variant
  pageBackground: "#0a0a0a", // dark --background
  quoteBar: "#5a9dc4", // dark --primary-variant
  surface: "#171717", // dark --card-background
  surfaceSubtle: "#1f2a31", // between dark --primary-quaternary and --muted
  textPrimary: "#fafafa", // dark --foreground
  textMuted: "#b8b8b8", // dark --muted-foreground
};
