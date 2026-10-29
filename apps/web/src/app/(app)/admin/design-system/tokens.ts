/**
 * The Masumi Family values the preview's swatches document: the preview
 * wrapper writes each one as a `--ds-*` custom property for the swatch to
 * paint, and the hex doubles as its label. The components on the page read
 * the app's own role tokens from `globals.css`.
 */
export interface Swatch {
  name: string;
  hex: string;
  cssVar: `--ds-${string}`;
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

/** Black at reduced opacity, for overlays and scrims only (guide 5.2). */
export const ALPHA_TONES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95].map(
  (step) => ({
    name: `Alpha ${step}`,
    cssVar: `--ds-alpha-${step}` as const,
    value: `rgb(0 0 0 / ${(100 - step) / 100})`,
  }),
);

/**
 * Values outside the palette, both Proposed. The positive mark is the one
 * status colour: warning is Golden Yellow and the X is Neutral 950. Dark Iris
 * is the dark primary at rest, mirroring `globals.css`.
 */
const PROPOSED_VALUES = {
  "--ds-positive": "#00D43B",
  "--ds-dark-iris": "#D141D1",
} as const;

/** Every `--ds-*` value, ready to spread into the preview wrapper's style. */
export const DESIGN_SYSTEM_VARS: Record<`--ds-${string}`, string> = {
  ...Object.fromEntries(
    [...PALETTE, ...NEUTRALS].map((swatch) => [swatch.cssVar, swatch.hex]),
  ),
  ...Object.fromEntries(ALPHA_TONES.map((tone) => [tone.cssVar, tone.value])),
  ...PROPOSED_VALUES,
};

/** Section 5.2 of the guide: one role, a light step and a dark step. */
export const THEME_ROLES = [
  { key: "page", light: "--ds-white", dark: "--ds-neutral-950" },
  { key: "panel", light: "--ds-neutral-100", dark: "--ds-neutral-900" },
  { key: "component", light: "--ds-white", dark: "--ds-neutral-950" },
  { key: "border", light: "--ds-neutral-200", dark: "--ds-neutral-800" },
  { key: "fieldBorder", light: "--ds-neutral-300", dark: "--ds-neutral-700" },
  { key: "text", light: "--ds-neutral-900", dark: "--ds-neutral-50" },
  { key: "mutedText", light: "--ds-neutral-500", dark: "--ds-neutral-400" },
  { key: "disabledText", light: "--ds-neutral-400", dark: "--ds-neutral-600" },
  { key: "primary", light: "--ds-iris-flower", dark: "--ds-dark-iris" },
  {
    key: "textOnPrimary",
    light: "--ds-neutral-950",
    dark: "--ds-neutral-950",
  },
  { key: "scrim", light: "--ds-alpha-50", dark: "--ds-alpha-50" },
] as const;

/** Gradient starting pairs (to be decided in the guide). */
export const GRADIENTS = [
  {
    key: "sakura",
    value:
      "linear-gradient(135deg, var(--ds-iris-flower), var(--ds-vivid-sakura))",
  },
  {
    key: "crimson",
    value:
      "linear-gradient(135deg, var(--ds-iris-flower), var(--ds-crimson-purple))",
  },
  {
    key: "peach",
    value:
      "linear-gradient(135deg, var(--ds-peach-blossom), var(--ds-iris-flower))",
  },
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

/** Inter weights (guide 5.3). Light is display only, never body. */
export const WEIGHTS = [
  { name: "Light", value: 300, className: "font-light" },
  { name: "Regular", value: 400, className: "font-normal" },
  { name: "Medium", value: 500, className: "font-medium" },
  { name: "Semibold", value: 600, className: "font-semibold" },
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

/** Guide 5.10: press and hover feedback, and enter animations. */
export const MOTION_TOKENS = [
  { key: "feedback", duration: "150ms" },
  { key: "enter", duration: "200ms" },
] as const;
