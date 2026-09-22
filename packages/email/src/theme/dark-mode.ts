import { DARK_PALETTE } from "./palette.js";

/**
 * Class hooks for the dark-mode override.
 *
 * Colours ship as inline styles so every client renders the light email
 * correctly. Inline styles beat a stylesheet, so the dark rules below carry
 * `!important`. Clients that ignore `prefers-color-scheme` keep the light
 * email, which stays legible.
 */
export const DARK_CLASS = {
  card: "sk-card",
  code: "sk-code",
  heading: "sk-heading",
  logo: "sk-logo",
  link: "sk-link",
  page: "sk-page",
  panel: "sk-panel",
  quote: "sk-quote",
  rule: "sk-rule",
  solid: "sk-solid",
  spine: "sk-spine",
  text: "sk-text",
  textMuted: "sk-text-muted",
} as const;

/** CSS injected into `<head>`. Only the dark override lives here. */
export function darkModeCss(): string {
  const p = DARK_PALETTE;

  return `@media (prefers-color-scheme: dark) {
  .${DARK_CLASS.page} { background-color: ${p.pageBackground} !important; }
  .${DARK_CLASS.card} { background-color: ${p.surface} !important; border-color: ${p.cardBorder} !important; }
  .${DARK_CLASS.logo} { filter: invert(1) !important; }
  .${DARK_CLASS.heading} { color: ${p.textPrimary} !important; }
  .${DARK_CLASS.text} { color: ${p.textPrimary} !important; }
  .${DARK_CLASS.textMuted} { color: ${p.textMuted} !important; }
  .${DARK_CLASS.panel} { background-color: ${p.surfaceSubtle} !important; border-color: ${p.hairline} !important; }
  .${DARK_CLASS.quote} { background-color: ${p.surfaceSubtle} !important; border-left-color: ${p.quoteBar} !important; }
  .${DARK_CLASS.code} { background-color: ${p.codeSurface} !important; border-color: ${p.hairline} !important; }
  .${DARK_CLASS.rule} { border-color: ${p.hairline} !important; }
  .${DARK_CLASS.link} { color: ${p.link} !important; }
  .${DARK_CLASS.spine} { background-color: ${p.accent} !important; }
  .${DARK_CLASS.solid} { background-color: ${p.accentSolid} !important; color: ${p.accentForeground} !important; }
}`;
}
