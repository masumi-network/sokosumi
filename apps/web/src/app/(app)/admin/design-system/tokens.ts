/**
 * The Masumi Family values the preview documents. Swatches paint from the CSS
 * variables in `design-system.css`; `hex` is only the label printed under each
 * one, so the brand values stay readable on the page.
 */
export interface Swatch {
  name: string;
  hex: string;
  cssVar: string;
}

/** The one primary, shared by every brand in the family. */
export const IRIS_FLOWER: Swatch = {
  name: "Iris Flower",
  hex: "#FF51FF",
  cssVar: "--ds-iris-flower",
};

export const PALETTE: Swatch[] = [
  { name: "Crimson Purple", hex: "#460A23", cssVar: "--ds-crimson-purple" },
  IRIS_FLOWER,
  { name: "Electric Pink", hex: "#FA008C", cssVar: "--ds-electric-pink" },
  { name: "Vivid Sakura", hex: "#FF6ED2", cssVar: "--ds-vivid-sakura" },
  { name: "Peach Blossom", hex: "#FFC8F0", cssVar: "--ds-peach-blossom" },
  { name: "Sand", hex: "#D7BE8C", cssVar: "--ds-sand" },
  { name: "Persimmon", hex: "#FF6400", cssVar: "--ds-persimmon" },
  { name: "Scarlet", hex: "#FA140A", cssVar: "--ds-scarlet" },
  { name: "Golden Yellow", hex: "#FFD300", cssVar: "--ds-golden-yellow" },
];

export const NEUTRALS: Swatch[] = [
  { name: "Black", hex: "#000000", cssVar: "--ds-black" },
  { name: "950", hex: "#0C0C0C", cssVar: "--ds-neutral-950" },
  { name: "900", hex: "#171717", cssVar: "--ds-neutral-900" },
  { name: "800", hex: "#262626", cssVar: "--ds-neutral-800" },
  { name: "700", hex: "#404040", cssVar: "--ds-neutral-700" },
  { name: "600", hex: "#525252", cssVar: "--ds-neutral-600" },
  { name: "500", hex: "#737373", cssVar: "--ds-neutral-500" },
  { name: "400", hex: "#A3A3A3", cssVar: "--ds-neutral-400" },
  { name: "300", hex: "#D4D4D4", cssVar: "--ds-neutral-300" },
  { name: "200", hex: "#E5E5E5", cssVar: "--ds-neutral-200" },
  { name: "100", hex: "#F5F5F5", cssVar: "--ds-neutral-100" },
  { name: "50", hex: "#FAFAFA", cssVar: "--ds-neutral-50" },
  { name: "White", hex: "#FFFFFF", cssVar: "--ds-white" },
];

/** Section 5.2 of the guide: one role, a light step and a dark step. */
export const THEME_ROLES = [
  { key: "page", light: "--ds-white", dark: "--ds-neutral-950" },
  { key: "panel", light: "--ds-neutral-100", dark: "--ds-neutral-900" },
  { key: "border", light: "--ds-neutral-200", dark: "--ds-neutral-800" },
  { key: "fieldBorder", light: "--ds-neutral-300", dark: "--ds-neutral-700" },
  { key: "text", light: "--ds-neutral-900", dark: "--ds-neutral-50" },
  { key: "mutedText", light: "--ds-neutral-500", dark: "--ds-neutral-400" },
  { key: "primary", light: "--ds-iris-flower", dark: "--ds-iris-flower" },
] as const;

export const GRADIENTS = [
  { key: "sakura", cssVar: "--ds-gradient-sakura" },
  { key: "crimson", cssVar: "--ds-gradient-crimson" },
  { key: "peach", cssVar: "--ds-gradient-peach" },
] as const;

export const RADII = [
  { key: "xs", className: "rounded-xs", px: 2 },
  { key: "sm", className: "rounded-sm", px: 6 },
  { key: "md", className: "rounded-md", px: 8 },
  { key: "lg", className: "rounded-lg", px: 10 },
  { key: "xl", className: "rounded-xl", px: 14 },
  { key: "2xl", className: "rounded-2xl", px: 16 },
  { key: "full", className: "rounded-full", px: null },
] as const;

/** Product UI type roles (guide 5.3, Proposed). */
export const TYPE_ROLES = [
  { key: "display", className: "text-3xl font-light tracking-tight" },
  { key: "heading", className: "text-lg font-semibold tracking-tight" },
  { key: "subheading", className: "text-base font-semibold" },
  { key: "body", className: "text-sm" },
  { key: "label", className: "text-xs font-medium" },
  { key: "caption", className: "text-xs" },
  { key: "micro", className: "text-2xs font-medium" },
] as const;

export const MOTION_TOKENS = [
  { key: "feedback", duration: "150ms" },
  { key: "confirm", duration: "160ms" },
  { key: "enter", duration: "200ms" },
  { key: "busy", duration: "1.1s" },
] as const;
