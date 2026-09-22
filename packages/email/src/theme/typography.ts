/**
 * Type scale, spacing rhythm, and shape used by every email.
 *
 * Email clients drop external stylesheets, so these values are applied as
 * inline styles. Keeping them here stops the same number appearing in three
 * templates with three different answers.
 */

/** 8px rhythm. Every margin and padding in an email is a multiple of it. */
export const SPACE = {
  xs: "4px",
  sm: "8px",
  md: "16px",
  lg: "24px",
  xl: "32px",
} as const;

export const RADIUS = {
  card: "16px",
  panel: "12px",
  control: "10px",
} as const;

/** Card depth. Clients that drop it keep the border. */
export const CARD_SHADOW =
  "0 1px 2px rgba(10, 10, 10, 0.04), 0 12px 32px rgba(10, 10, 10, 0.06)";

/** Web-safe stacks. Custom fonts do not survive Outlook. */
export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const MONO_STACK =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';

export const TEXT = {
  heading: {
    fontSize: "28px",
    fontWeight: 600,
    letterSpacing: "-0.02em",
    lineHeight: "36px",
  },
  body: {
    fontSize: "16px",
    lineHeight: "26px",
  },
  small: {
    fontSize: "14px",
    lineHeight: "22px",
  },
  micro: {
    fontSize: "12px",
    lineHeight: "20px",
  },
  label: {
    fontSize: "12px",
    fontWeight: 600,
    letterSpacing: "0.08em",
    lineHeight: "16px",
    textTransform: "uppercase",
  },
} as const;
