import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * One walk of `apps/web/src`, many guards. Each `it()` keeps the failure
 * message its old file used (path + line + rule). The walk itself is the
 * shared cost; the rules stay independent so a failure still names one rule.
 */

const SRC_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const WEB_ROOT = path.resolve(SRC_ROOT, "..");

const SELF_SRC = "lib/utils/__tests__/src-walk-guards.test.ts";

const WALK_EXTENSIONS = new Set([".ts", ".tsx", ".css"]);

interface SrcFile {
  relSrc: string;
  relWeb: string;
  relApp: string | null;
  ext: string;
  text: string;
  lines: string[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, out);
      continue;
    }
    if (WALK_EXTENSIONS.has(path.extname(name))) out.push(full);
  }
  return out;
}

const SRC_FILES: SrcFile[] = walk(SRC_ROOT).map((full) => {
  const relSrc = path.relative(SRC_ROOT, full).split(path.sep).join("/");
  const text = readFileSync(full, "utf8");
  return {
    relSrc,
    relWeb: path.relative(WEB_ROOT, full).split(path.sep).join("/"),
    relApp: relSrc.startsWith("app/") ? relSrc.slice("app/".length) : null,
    ext: path.extname(full),
    text,
    lines: text.split("\n"),
  };
});

// ---------------------------------------------------------------------------
// color tokens
// ---------------------------------------------------------------------------

/**
 * Guards the three rules in `.cursor/rules/color-tokens.mdc`. Each one is a
 * separate test so a failure names which rule broke.
 *
 * The opacity rule is now absolute. It used to cover only the ramps that had
 * solid steps to move to, because the neutral tokens were still faded by hand
 * in roughly 700 places. Those are all converted, so a modifier on any colour
 * utility is a bug from here on. Where a surface genuinely has to show what
 * sits behind it, the token carries the alpha: `--overlay`, `--surface-glass`,
 * `--surface-sticky`, `--scrim`.
 */

const TAILWIND_PALETTE = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
].join("|");

/**
 * `ring-offset` comes before `ring` because the alternation is ordered: with
 * `ring` first, `ring-offset-white` never reaches the palette branch and the
 * raw colour survives.
 */
const COLOR_UTILITIES =
  "bg|text|ring-offset|ring|inset-ring|border|outline|divide|fill|stroke|shadow|decoration|accent|caret|placeholder|from|via|to";

const RAW_PALETTE = new RegExp(
  `\\b(?:${COLOR_UTILITIES})-(?:(?:${TAILWIND_PALETTE})-\\d{2,3}|black|white)\\b`,
);

const COLOR_UTILITIES_NO_TEXT = COLOR_UTILITIES.split("|")
  .filter((utility) => utility !== "text")
  .join("|");

/**
 * `text-sm/6` sets a line height, not an opacity, so the font-size names are
 * the one thing a colour utility prefix can carry a slash for legitimately.
 * The exemption is scoped to `text-`: `shadow` takes the same size words and
 * a real opacity modifier, so an unscoped lookahead let `shadow-lg/25`
 * through.
 */
const FONT_SIZES = "2xs|xs|sm|base|lg|xl|[2-9]xl";

/**
 * The tail is a negative lookahead, not `\b`. A word boundary after `]` needs
 * a word character next, which a class name never has, so the arbitrary-value
 * branch was unreachable and `bg-primary/[0.04]` — the rule's own headline
 * example — compiled with the guard green.
 *
 * The head rejects a preceding `/`, `.` or `-`, which `\b` allows. Without it
 * a URL path reads as a modifier: `href="/agents/text-to-speech/1"` matches
 * `text-` then `to-speech` then `/1`. Every path puts a `/` in front of the
 * segment, so that one character separates the two cases.
 *
 * Blind spot: a path with no leading segment (`"text-to-speech/1"`) starts at
 * a quote, and so does a class list, so a line regex cannot tell them apart.
 * Nothing in the tree looks like that today.
 */
const TOKEN_OPACITY = new RegExp(
  `(?<![\\w/.-])(?:text-(?!(?:${FONT_SIZES})/)|(?:${COLOR_UTILITIES_NO_TEXT})-)[a-z0-9-]+/(?:\\[[0-9.]+%?\\]|\\d{1,3})(?![\\w.])`,
);

/**
 * A hex only counts when it is quote-delimited or inside an arbitrary Tailwind
 * value. A bare `#3617` in prose is an issue number, not a color.
 */
const COLOR_LITERAL =
  /(?:["'`]#[0-9a-fA-F]{3,8}["'`]|-\[#[0-9a-fA-F]{3,8}|\brgba?\(\s*\d|\bhsla?\(\s*\d|\boklch\(\s*[\d.])/;

/**
 * Third-party brand marks and anything that hands a concrete color string to a
 * canvas, an OS surface, or a color picker. None of these can read a CSS
 * custom property.
 */
const LITERAL_ALLOWLIST = new Set([
  // Brand marks belong to the providers, not to us.
  "components/social-icons.tsx",
  "components/soko-bot/provider-logos.tsx",
  // The user picks the value; these are the swatches and the empty state.
  "components/ui/color-picker.tsx",
  "components/job-input/inputs/color-input.tsx",
  // Renders when the stylesheet itself failed to load.
  "app/global-error.tsx",
  // `srcdoc` for an isolated iframe, which does not inherit our tokens.
  "components/ui/image-viewer.tsx",
  // Read by the OS, not by CSS.
  "app/manifest.ts",
  "components/pwa/apple-pwa-head.tsx",
  // A canvas library needs a resolved string; it reads `--primary` first and
  // only falls back to the literal.
  "app/(app)/personal-assistant/components/chat/thinking-orb.tsx",
  // Canvas painters. Both build a concrete string for a 2D context.
  "lib/aurora-orb.ts",
  "lib/job-input/form.ts",
]);

function findColorViolations(
  pattern: RegExp,
  skip: (rel: string) => boolean = () => false,
): string[] {
  const violations: string[] = [];
  for (const file of SRC_FILES) {
    if (file.ext !== ".ts" && file.ext !== ".tsx") continue;
    if (file.relSrc === SELF_SRC || skip(file.relSrc)) continue;
    file.lines.forEach((line, index) => {
      if (pattern.test(line)) {
        violations.push(`${file.relSrc}:${index + 1}: ${line.trim()}`);
      }
    });
  }
  return violations;
}

describe("color tokens", () => {
  it("uses no raw Tailwind palette colors", () => {
    // No allowlist here. LITERAL_ALLOWLIST exempts files that must hand a
    // concrete colour string to something that cannot read a custom property;
    // none of them has any reason to write a palette class.
    const violations = findColorViolations(RAW_PALETTE);

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("puts no opacity modifier on any color utility", () => {
    const violations = findColorViolations(TOKEN_OPACITY);

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("has no color literal in a component", () => {
    const violations = findColorViolations(
      COLOR_LITERAL,
      (rel) => LITERAL_ALLOWLIST.has(rel) || rel.includes(".test."),
    );

    expect(violations, violations.join("\n")).toEqual([]);
  });

  /**
   * A fourth rule, about the stylesheet rather than the call sites. Tailwind
   * builds a utility only for a token `@theme inline` bridges, and it inlines
   * the bridge, so a name with no bridge emits nothing at all and a bridge
   * with no value emits `var(--missing)`, which falls back to `currentColor`.
   * Both fail in silence with every test green. This stack shipped one of
   * each before anyone noticed.
   */
  describe("the stylesheet", () => {
    const stylesheet = readFileSync(
      path.join(SRC_ROOT, "app/globals.css"),
      "utf8",
    );

    function block(selector: string): string {
      const start = stylesheet.indexOf(`\n${selector} {`);
      const body = stylesheet.slice(start);
      return body.slice(0, body.indexOf("\n}\n"));
    }

    function definitions(selector: string): Set<string> {
      return new Set(
        [...block(selector).matchAll(/^ {2}(--[a-z0-9-]+):/gm)].map(
          (match) => match[1],
        ),
      );
    }

    const light = definitions(":root");
    const dark = definitions(".dark");

    it("defines every bridged token", () => {
      // `\s*` around the value, not a space: Prettier wraps a bridge whose
      // two names do not fit on one line, and a single-line pattern reads
      // those as absent. Two of them are, and both went unchecked.
      const bridges = [
        ...block("@theme inline").matchAll(
          /^ {2}--color-[a-z0-9-]+:\s*var\(\s*(--[a-z0-9-]+)\s*\);/gm,
        ),
      ].map((match) => match[1]);

      // Every `--color-*` in the block is a bridge, so the two counts must
      // agree. Without this the scan can silently skip a bridge whose shape
      // the pattern does not cover, and skipping one is how the dangling
      // bridge shipped in the first place.
      const declared = [
        ...block("@theme inline").matchAll(/^ {2}--color-[a-z0-9-]+:/gm),
      ].length;

      expect(bridges.length, "the bridge scan skipped a bridge").toBe(declared);

      const dangling = bridges.filter(
        (token) => !light.has(token) && !dark.has(token),
      );

      expect(dangling, dangling.join(", ")).toEqual([]);
    });

    it("defines the same tokens in both themes", () => {
      const lightOnly = [...light].filter((token) => !dark.has(token));
      const darkOnly = [...dark].filter((token) => !light.has(token));

      expect(
        { lightOnly, darkOnly },
        "a token defined in one theme only takes the other theme's value",
      ).toEqual({ lightOnly: [], darkOnly: [] });
    });
  });
});

// ---------------------------------------------------------------------------
// whole pixels
// ---------------------------------------------------------------------------

/**
 * A fractional px is a length the display cannot draw. A 1x screen, which is
 * most Windows hardware, has no half pixel, so the browser rounds: a 1.5px
 * border lands at 1px on one edge and 2px on the opposite one, and a 0.2px
 * border rounds away to nothing. On a 2x Mac the same value looks deliberate,
 * which is why it keeps getting written.
 *
 * The ban covers lengths that resolve to a painted edge or a box dimension.
 * It does not cover continuous values, which are interpolated rather than
 * snapped and are legitimately fractional:
 *
 *   - blur and shadow radii (`blur(1.5px)`, `--chat-jump-dim-blur: 1.5px`)
 *   - translations inside a keyframe, which the compositor tweens anyway
 *   - unitless scale factors
 */
const LAYOUT_PROPS =
  "width|height|size|min-width|max-width|min-height|max-height|padding|margin|gap|row-gap|column-gap|top|right|bottom|left|inset|border|border-width|border-top-width|border-right-width|border-bottom-width|border-left-width|outline|outline-width|outline-offset";

/** `padding: 1.5px`, `border: 0.2px solid transparent`, in css and in template css. */
const CSS_FRACTIONAL = new RegExp(
  `(?:^|[;{\\s])(?:${LAYOUT_PROPS})\\s*:\\s*[^;{}]*?\\b\\d*\\.\\d+px`,
  "i",
);

/** `border: "0.2px solid transparent"` and `padding: "1.5px"` in a style object. */
const STYLE_OBJECT_FRACTIONAL =
  /\b(?:width|height|padding|margin|gap|top|right|bottom|left|inset|border|borderWidth|borderTopWidth|borderRightWidth|borderBottomWidth|borderLeftWidth|outline|outlineWidth|outlineOffset)\s*:\s*["'`][^"'`]*?\b\d*\.\d+px/;

/** Tailwind arbitrary values: `p-[1.5px]`, `border-[0.5px]`, `size-[1.5px]`. */
const TAILWIND_FRACTIONAL =
  /(?:^|[\s"'`:])-?(?:w|h|size|min-w|max-w|min-h|max-h|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|top|right|bottom|left|inset|inset-x|inset-y|border|border-x|border-y|border-t|border-r|border-b|border-l|outline|outline-offset|ring|ring-offset)-\[\d*\.\d+px\]/;

/*
 * There is deliberately no line-level exemption list. The three patterns above
 * name the properties and utilities they cover, and none of them is a blur, a
 * shadow, a filter or a transform, so a continuous value is already out of
 * scope. An exemption keyed on the whole line would instead disarm the check
 * for any line that happens to also carry `shadow-lg`, which is most of them.
 */

describe("whole pixels", () => {
  it("puts no fractional px on a layout or border length", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.relSrc.endsWith(".test.ts") || file.relSrc.endsWith(".test.tsx"))
        continue;

      file.lines.forEach((line, index) => {
        if (line.trimStart().startsWith("//")) return;
        if (line.trimStart().startsWith("*")) return;
        const hit =
          CSS_FRACTIONAL.test(line) ||
          STYLE_OBJECT_FRACTIONAL.test(line) ||
          TAILWIND_FRACTIONAL.test(line);
        if (hit) violations.push(`${file.relSrc}:${index + 1}: ${line.trim()}`);
      });
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// no fixed or off-scale font sizes
// ---------------------------------------------------------------------------

/**
 * Paths relative to apps/web/src that may set a literal font size, each with
 * the reason it cannot use the scale.
 */
const FONT_SIZE_ALLOWLIST = new Map([
  [
    "app/api/export/pdf/route.ts",
    "PDF export chrome rendered by Puppeteer, not product UI",
  ],
  [
    "app/global-error.tsx",
    "replaces the root layout, so no app CSS loads; its inline 0.875rem is text-sm",
  ],
]);

/**
 * Any unit, not just px: `text-[13px]` and `text-[0.8125rem]` are the same
 * off-scale 13px, and the rem spelling let ~130 of them past a px-only check.
 * The `length:` hints are caught whatever they hold, a literal or a variable
 * (`text-[length:var(--x)]`, `text-(length:--x)`): either way the size comes
 * from somewhere other than the scale. Sizes come from the scale (`text-2xs`
 * through `text-4xl`). Intentional limit: does not scan template assignments
 * like root.style.fontSize = `${n}px`.
 */
const TEXT_ARBITRARY_SIZE =
  /text-\[(?:length:[^\]]*|\d*\.?\d+[a-z%]+)\]|text-\(length:[^)]*\)/;
/** A literal size in CSS or an inline style string, in px, rem or em. */
const FONT_SIZE_DECL = /font-size:\s*\d*\.?\d+(?:px|r?em)\b/i;
const FONT_SIZE_STYLE_NUM = /fontSize:\s*\d+(?:\.\d+)?\b/;
const FONT_SIZE_STYLE_STR = /fontSize:\s*["'`]\d*\.?\d+(?:px|r?em)["'`]/;

describe("no fixed or off-scale font sizes in product UI", () => {
  it("has no text-[N<unit>], text-(length:…), or literal font-size outside allowlist", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (FONT_SIZE_ALLOWLIST.has(file.relSrc)) continue;
      // Self + apply unit tests mock { fontSize: "28px" } style objects.
      if (file.relSrc.endsWith("src-walk-guards.test.ts")) continue;
      if (file.relSrc.endsWith("dynamic-type.test.ts")) continue;

      file.lines.forEach((line, i) => {
        if (
          TEXT_ARBITRARY_SIZE.test(line) ||
          FONT_SIZE_DECL.test(line) ||
          FONT_SIZE_STYLE_NUM.test(line) ||
          FONT_SIZE_STYLE_STR.test(line)
        ) {
          violations.push(`${file.relSrc}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// equal width and height use size-N
// ---------------------------------------------------------------------------

/**
 * `DESIGN.md` → Iconography: any equal width and height, icon or not, is
 * `size-N` (including `size-full`), never `h-N w-N`. About seventy pairs had
 * piled up, half of them `h-full w-full`.
 *
 * The check reads one string literal at a time, so two elements on one line
 * stay separate. A pair matches when the variant chain, the `!` and the value
 * agree, in either order: `h-4 w-4`, `w-full h-full`, `md:h-6 md:w-6`,
 * `[&_svg]:h-5 [&_svg]:w-5`. `h-6 md:w-6` and `h-4 w-5` are different boxes
 * and pass. The variant split skips colons inside `[…]`, so an arbitrary
 * variant such as `[&:hover]:` stays one prefix.
 */
const STRING_LITERAL = /"[^"\n]*"|'[^'\n]*'|`[^`]*`/g;

/** `md:h-6` → `{ size: "md:size-6", axis: "h" }`; null for anything else. */
function boxSide(token: string): { size: string; axis: string } | null {
  let depth = 0;
  let cut = -1;
  for (let index = 0; index < token.length; index++) {
    const char = token[index];
    if (char === "[") depth++;
    else if (char === "]") depth--;
    else if (char === ":" && depth === 0) cut = index;
  }
  const utility = token.slice(cut + 1);
  const important = utility.startsWith("!") || utility.endsWith("!");
  const match = /^!?([hw])-(.+?)!?$/.exec(utility);
  if (!match) return null;
  const size = `${token.slice(0, cut + 1)}size-${match[2]}${important ? "!" : ""}`;
  return { size, axis: match[1] };
}

function equalBoxPairs(literal: string): string[] {
  const axes = new Map<string, Set<string>>();
  for (const token of literal.slice(1, -1).split(/\s+/)) {
    const side = boxSide(token);
    if (!side) continue;
    const seen = axes.get(side.size) ?? new Set<string>();
    seen.add(side.axis);
    axes.set(side.size, seen);
  }
  return [...axes].filter(([, seen]) => seen.size === 2).map(([size]) => size);
}

describe("size-N", () => {
  it("writes every equal width and height as size-N", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.relSrc === SELF_SRC || file.relSrc.includes(".test.")) continue;

      file.lines.forEach((line, index) => {
        for (const literal of line.match(STRING_LITERAL) ?? []) {
          for (const size of equalBoxPairs(literal)) {
            violations.push(`${file.relSrc}:${index + 1}: use ${size}`);
          }
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("matches either order and any variant, but only equal boxes", () => {
    expect(equalBoxPairs('"flex h-4 w-4"')).toEqual(["size-4"]);
    expect(equalBoxPairs('"w-full p-2 h-full"')).toEqual(["size-full"]);
    expect(equalBoxPairs('"size-24 md:h-32 md:w-32"')).toEqual(["md:size-32"]);
    expect(equalBoxPairs('"[&_svg]:h-5 [&_svg]:w-5"')).toEqual([
      "[&_svg]:size-5",
    ]);
    expect(equalBoxPairs('"h-6 md:w-6 h-4 w-5 h-full min-w-full"')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// no transition-all
// ---------------------------------------------------------------------------

/**
 * `DESIGN.md` → Motion: name the properties you transition. `transition-all`
 * animates whatever changes next, so a width, a padding or a focus ring's
 * `box-shadow` starts to tween by accident. Pick `transition-colors`,
 * `-opacity`, `-transform`, or a `transition-[…]` list of what the element
 * actually changes. A bar that grows animates `scaleX` from `origin-left`,
 * not `width`.
 */
const TRANSITION_ALL =
  /(?<![\w-])transition-all(?![\w-])|\btransition(?:-property)?\s*:\s*["']?all\b/;

describe("transition-all", () => {
  it("names the properties every transition animates", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.relSrc === SELF_SRC || file.relSrc.includes(".test.")) continue;

      file.lines.forEach((line, index) => {
        if (TRANSITION_ALL.test(line)) {
          violations.push(`${file.relSrc}:${index + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// full-bleed rules + page gutters
// ---------------------------------------------------------------------------

/**
 * A rule that spans the view escapes the app's horizontal gutter with a
 * negative margin. There is exactly one gutter to escape: `p-4` on
 * `main[data-app-main]` in `authenticated-app-frame.tsx`. So there is exactly
 * one correct value, `-mx-4`, and any other number is a bug you can see.
 *
 * `-mx-6` was the old habit, from pages that added `px-2` of their own on top
 * of the shell. It measured right on those two pages and overshot by 8px
 * everywhere else. Pages no longer add a second gutter, so 24px is now wrong
 * everywhere.
 *
 * This checks the value, not whether a given rule should bleed at all. A
 * centred column inside a `max-w-*` wrapper has its own padding and no rule
 * crossing the view, and is out of scope.
 */
const CANONICAL_BLEED = "-mx-4";

/** A negative horizontal margin on the same element as a painted rule. */
const BLEEDING_RULE =
  /className=\{?\s*(?:cn\()?\s*["'`][^"'`]*(?:\bborder-[tbxy]\b|\bborder-border\b)[^"'`]*["'`]/;
const NEGATIVE_MX = /(?:^|[\s"'`])(-mx-(?:\d+(?:\.\d+)?|\[[^\]]+\]))/g;

describe("full-bleed rules", () => {
  it("escapes the one app gutter, never more and never less", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.ext !== ".tsx") continue;
      if (file.relSrc.endsWith(".test.tsx")) continue;

      file.lines.forEach((line, index) => {
        if (!BLEEDING_RULE.test(line)) return;
        for (const [, value] of line.matchAll(NEGATIVE_MX)) {
          if (value === CANONICAL_BLEED) continue;
          violations.push(
            `${file.relSrc}:${index + 1}: ${value} in ${line.trim()}`,
          );
        }
      });
    }

    expect(violations).toEqual([]);
  });
});

/**
 * The other half of the same invariant. `-mx-4` reaches the edge only while
 * `main` holds the only gutter, so a page that wraps itself in a second one
 * silently shortens every rule below it by that much.
 *
 * Seven roots still did. `drive-page-client.tsx` and `tasks-loading-view.tsx`
 * each paired a `px-2` root with an `-mx-4` rule, so the rule stopped 8px
 * short on both sides. The skeleton roots were worse than cosmetic: the tasks
 * page had already dropped its `px-2` and its skeleton had not, so the content
 * jumped 8px sideways the moment the page loaded.
 *
 * The scan reads route files and the page-level views they render, and looks
 * for a full-width wrapper that also pads horizontally. Its blind spot is
 * spelling. It reads `px-*` only, because `pl-8` on a full-width search input
 * is an icon inset rather than a gutter, and it reads the literal `w-full`, so
 * a root written as `min-w-full` or assembled from a variable, or a page view
 * named outside these patterns, is invisible to it. It catches the shape that
 * actually occurred.
 */
const PAGE_ROOT_FILES =
  /(?:^|\/)(?:page|loading)\.tsx$|-page-client\.tsx$|-loading-view\.tsx$|-skeleton(?:-host)?\.tsx$/;
const SECOND_GUTTER = /\bw-full\s+(px-(?:\d+(?:\.\d+)?|\[[^\]]+\]))/;

describe("page gutters", () => {
  it("leaves the one gutter to the app shell", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.ext !== ".tsx") continue;
      if (!file.relSrc.startsWith("app/(app)/")) continue;
      if (file.relSrc.endsWith(".test.tsx")) continue;
      if (!PAGE_ROOT_FILES.test(file.relSrc)) continue;

      file.lines.forEach((line, index) => {
        const match = line.match(SECOND_GUTTER);
        if (match) violations.push(`${file.relSrc}:${index + 1}: ${match[0]}`);
      });
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// z-index ceiling
// ---------------------------------------------------------------------------

/**
 * `z-50` is the overlay layer: dropdowns, popovers, dialogs. A surface above
 * it outranks every one of them, so each is a decision rather than a habit,
 * and each is listed here with its reason. `DESIGN.md` → Elevation & Depth
 * names the same two.
 *
 * Reads class utilities (`z-60`, `z-[60]`, `md:z-[60]`), CSS `z-index: N` and
 * a literal `zIndex: N` in a style object. A computed `zIndex` (stacked
 * avatars count down from the list length) is out of scope.
 */
const OVERLAY_LAYER = 50;

const ABOVE_OVERLAY_ALLOWLIST = new Map([
  // Full-screen search takeover; it has to cover the `z-50` sticky header.
  ["app/(app)/components/header/header-mobile-search.client.tsx", 60],
  // Consent has to stay reachable over any dialog or sheet that is open.
  ["components/analytics/cookie-banner.tsx", 100],
]);

const Z_UTILITY = /(?<![\w-])z-(?:(\d+)|\[(\d+)\])(?![\w-])/g;
const Z_DECLARATION = /\bz-index\s*:\s*(\d+)|\bzIndex\s*:\s*(\d+)\b/g;

describe("z-index ceiling", () => {
  it("keeps everything at or below the overlay layer outside the allowlist", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.relSrc === SELF_SRC || file.relSrc.includes(".test.")) continue;
      const allowed = ABOVE_OVERLAY_ALLOWLIST.get(file.relSrc);

      file.lines.forEach((line, index) => {
        for (const pattern of [Z_UTILITY, Z_DECLARATION]) {
          for (const match of line.matchAll(pattern)) {
            const value = Number(match[1] ?? match[2]);
            if (value <= OVERLAY_LAYER || value === allowed) continue;
            violations.push(`${file.relSrc}:${index + 1}: ${match[0]}`);
          }
        }
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("keeps the allowlist free of files that no longer go above it", () => {
    const stale = [...ABOVE_OVERLAY_ALLOWLIST].filter(([rel, value]) => {
      const file = SRC_FILES.find((candidate) => candidate.relSrc === rel);
      return !file?.text.includes(`z-[${value}]`);
    });

    expect(stale.map(([rel]) => rel)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shadow ceiling
// ---------------------------------------------------------------------------

/**
 * `DESIGN.md` → Elevation & Depth: borders first, then a soft glow, and
 * `shadow-lg` is the ceiling. `shadow-xl` and `shadow-2xl` are out under any
 * variant (`md:`, `hover:`, `focus-within:`), and so is an arbitrary
 * `shadow-[…]` drop shadow, which is the same thing spelled by hand.
 *
 * An arbitrary `shadow-[inset_…]` passes: with no offset outward it draws a
 * hairline or a rail inside the box, which is a border, not elevation.
 * `drop-shadow-*`, `text-shadow-*` and `inset-shadow-*` are other utilities
 * and pass. Blind spot: a `boxShadow` in a style object or `box-shadow` in
 * CSS. Nothing in the tree lifts that way today.
 */
const SHADOW_ABOVE_CEILING =
  /(?<![\w-])shadow-(?:xl|2xl|\[(?!inset_)[^\]]*\])(?![\w-])/;

describe("shadow ceiling", () => {
  it("lifts nothing above shadow-lg", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.relSrc === SELF_SRC || file.relSrc.includes(".test.")) continue;

      file.lines.forEach((line, index) => {
        const match = line.match(SHADOW_ABOVE_CEILING);
        if (match) violations.push(`${file.relSrc}:${index + 1}: ${match[0]}`);
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// radius scale
// ---------------------------------------------------------------------------

/**
 * `DESIGN.md` → Shapes: radii come from the scale (`rounded-xs` through
 * `rounded-2xl`, and `rounded-full`), never a hand-written length. A
 * hardcoded radius does not follow `--radius`, so it drifts the moment the
 * scale moves; two inline ones sat 0.4px and 2px off the class on the same
 * element and quietly won.
 *
 * Reads arbitrary Tailwind radii in any unit, on any side or corner and with
 * any number of values (`rounded-[4px]`, `md:rounded-t-[0.5rem]`,
 * `rounded-[4px_8px]`), and a literal radius in a style object, shorthand or
 * longhand (`borderRadius: 8`, `borderTopLeftRadius: "0.65rem"`). A keyword or
 * a token passes: `rounded-[inherit]`, `borderRadius: "var(--radius-lg)"`.
 * Blind spot: `border-radius` in a stylesheet, where the scrollbar pill and
 * the search rail still write lengths; CSS has no utility to reach for.
 */
const ARBITRARY_RADIUS = /(?<![\w-])rounded(?:-[a-z]{1,2})?-\[\.?\d[^\]]*\]/;
const STYLE_RADIUS =
  /\bborder(?:Top|Bottom|Start|End)?(?:Left|Right|Start|End)?Radius\s*:\s*(?:\d[\d.]*|["'`]\s*\.?\d[^"'`]*["'`])/;

describe("radius scale", () => {
  it("takes every radius from the scale", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.ext !== ".ts" && file.ext !== ".tsx") continue;
      if (file.relSrc === SELF_SRC || file.relSrc.includes(".test.")) continue;

      file.lines.forEach((line, index) => {
        const match = line.match(ARBITRARY_RADIUS) ?? line.match(STYLE_RADIUS);
        if (match) violations.push(`${file.relSrc}:${index + 1}: ${match[0]}`);
      });
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("matches hand-written lengths only", () => {
    const hits = [
      '"rounded-[4px]"',
      '"md:rounded-tl-[0.5rem]"',
      '"rounded-[4px_8px]"',
      "{ borderRadius: 6 }",
      '{ borderRadius: "0.65rem" }',
      '{ borderTopLeftRadius: "4px" }',
    ];
    for (const line of hits) {
      expect(ARBITRARY_RADIUS.test(line) || STYLE_RADIUS.test(line), line).toBe(
        true,
      );
    }

    const passes = [
      '"rounded-[inherit] rounded-t-[inherit] rounded-xs rounded-2xl"',
      '"rounded-[calc(var(--radius)-2px)]"',
      '{ borderRadius: "var(--radius-lg)" }',
      '"--border-radius": "var(--radius-lg)"',
    ];
    for (const line of passes) {
      expect(ARBITRARY_RADIUS.test(line) || STYLE_RADIUS.test(line), line).toBe(
        false,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// icon buttons have a name
// ---------------------------------------------------------------------------

/**
 * lucide-react adds `aria-hidden="true"` to any icon without an accessibility
 * prop, so a `<Button size="icon">` that holds only an icon has no name at
 * all: a screen reader announces "button" and nothing else. The sidebar
 * toggle, both share modals' copy buttons and the member menus shipped that
 * way.
 *
 * A button passes with `aria-label`, `aria-labelledby` or `title` on the
 * button, `sr-only` text or an `aria-label` inside it (an `asChild` link
 * carries its own), `aria-hidden` (a disabled skeleton placeholder), or a
 * props spread, where the caller supplies the name.
 */
const ICON_SIZE = /\bsize=(?:"icon"|'icon'|\{\s*"icon"\s*\})/;
const NAMED_TAG =
  /\b(?:aria-label|aria-labelledby|title)=|\baria-hidden\b|\{\s*\.\.\./;
const NAMED_BODY = /\bsr-only\b|\baria-label=/;

/** The opening tag starting at `start`, skipping `>` inside braces and quotes. */
function openingTag(text: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === "{") depth++;
    else if (char === "}") depth--;
    else if (depth === 0 && (char === '"' || char === "'")) quote = char;
    else if (depth === 0 && char === ">") return text.slice(start, index + 1);
  }
  return text.slice(start);
}

describe("icon buttons", () => {
  it("gives every icon-only button an accessible name", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.ext !== ".tsx" || file.relSrc.includes(".test.")) continue;

      for (const match of file.text.matchAll(/<Button\b/g)) {
        const tag = openingTag(file.text, match.index);
        if (!ICON_SIZE.test(tag) || NAMED_TAG.test(tag)) continue;

        const bodyStart = match.index + tag.length;
        const body = tag.endsWith("/>")
          ? ""
          : file.text.slice(
              bodyStart,
              file.text.indexOf("</Button>", bodyStart),
            );
        if (NAMED_BODY.test(body)) continue;

        const line = file.text.slice(0, match.index).split("\n").length;
        violations.push(`${file.relSrc}:${line}: icon button has no name`);
      }
    }

    expect(violations, violations.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// focus rings appear at once
// ---------------------------------------------------------------------------

/**
 * A Tailwind ring is a `box-shadow`, so any transition that covers
 * `box-shadow` fades the focus ring in instead of showing it. That covers
 * `transition-all`, `transition-shadow`, a bare `transition`, and an
 * arbitrary list naming `box-shadow`. Fourteen primitives did it, Button among
 * them. `DESIGN.md` → Accessibility: never animate the ring.
 *
 * The check reads one class context at a time: a `className` value, a `cva()`
 * call, or a single string literal. Same-file string constants are inlined, so
 * `cn(CARD_SHELL, FOCUS_RING)` counts. A transition passed into `Button` (whose
 * ring lives in `button.tsx`) is still a separate context.
 */
const FOCUS_RING_CLASS = /\b(?:focus|focus-visible|focus-within):ring-/;
const ANIMATES_SHADOW =
  /(?<![\w-])transition(?:-all|-shadow)?(?![\w-])|\btransition-\[[^\]]*box-shadow/;

/** The balanced `open`…`close` span starting at `start`. */
function balanced(text: string, start: number, open: string, close: string) {
  let depth = 0;
  for (let index = start; index < text.length; index++) {
    if (text[index] === open) depth++;
    else if (text[index] === close && --depth === 0) {
      return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
}

/** `const CARD_SHELL = "…"` (quote may be on the next line). */
function constStrings(text: string): Map<string, string> {
  const consts = new Map<string, string>();
  for (const match of text.matchAll(
    /const\s+([A-Z][A-Z0-9_]*)\s*=\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g,
  )) {
    consts.set(match[1], match[2] ?? "");
  }
  return consts;
}

function expandConsts(value: string, consts: Map<string, string>): string {
  if (consts.size === 0) return value;
  return value.replace(/\b[A-Z][A-Z0-9_]*\b/g, (id) => consts.get(id) ?? id);
}

/** `end` is where the raw source of the context stops, before inlining. */
interface ClassContext {
  at: number;
  end: number;
  value: string;
}

function classContexts(text: string): ClassContext[] {
  const contexts: ClassContext[] = [];
  const consts = constStrings(text);
  for (const match of text.matchAll(/className=([{"])/g)) {
    const start = match.index + "className=".length;
    const value =
      match[1] === "{"
        ? balanced(text, start, "{", "}")
        : text.slice(start, text.indexOf('"', start + 1) + 1);
    contexts.push({
      at: match.index,
      end: start + value.length,
      value: expandConsts(value, consts),
    });
  }
  for (const match of text.matchAll(/\bcva\(/g)) {
    const start = match.index + "cva".length;
    const value = balanced(text, start, "(", ")");
    contexts.push({
      at: match.index,
      end: start + value.length,
      value: expandConsts(value, consts),
    });
  }
  for (const match of text.matchAll(/"[^"\n]*"|`[^`]*`/g)) {
    contexts.push({
      at: match.index,
      end: match.index + match[0].length,
      value: match[0],
    });
  }
  return contexts;
}

/**
 * The contexts no wider one contains. A literal inside `cn(…)` or a `cva()`
 * variant is only part of its element's classes, so a rule that needs two
 * classes together reads the whole call instead.
 */
function outermostContexts(contexts: ClassContext[]): ClassContext[] {
  return contexts.filter(
    (inner) =>
      !contexts.some(
        (outer) =>
          outer !== inner &&
          outer.at <= inner.at &&
          inner.end <= outer.end &&
          outer.end - outer.at > inner.end - inner.at,
      ),
  );
}

/**
 * The other half of `DESIGN.md` → Accessibility → Focus rings: a ring always
 * has a width. `focus-visible:ring-ring` sets only the colour of a ring that
 * is 0px wide, so next to `outline-none` the control shows no focus at all.
 * Six controls shipped that way.
 *
 * In one class context (see `classContexts`), every `ring-<colour>` or
 * `inset-ring-<colour>` whose variant chain holds a focus state (`focus:`,
 * `focus-visible:`, `focus-within:`, or the `group-`/`peer-` forms, anywhere
 * in the chain: `md:focus-visible:`, `focus-visible:after:`) needs a width of
 * the same kind (`ring`, `ring-2`, `ring-[3px]`) that applies whenever the
 * colour does: one whose variants are all in the colour's chain, so the same
 * chain, a shorter one (`after:ring-2` covers `focus-visible:after:`), or a
 * bare one. A zero width (`ring-0`, `ring-[0px]`) is no width.
 * `ring-offset-*` and `ring-inset` are not colours.
 *
 * Blind spot: a width that arrives from somewhere else, such as a colour
 * override passed to `Button`, whose `ring-2` lives in `button.tsx`. That
 * reads as missing and has to be written out, which is also what makes the
 * call site honest about what it draws.
 */
const FOCUS_STATE =
  /^(?:group-|peer-)?focus(?:-visible|-within)?(?:\/[\w-]+)?$/;
const RING_UTILITY = /^!?(inset-ring|ring)(?:-(.+?))?!?$/;
const RING_WIDTH = /^(?:\d+|\[\d*\.?\d+(?:px|rem|em)\])$/;
const ZERO_WIDTH = /^(?:0+|\[0*\.?0+(?:px|rem|em)\])$/;

/** `md:[&:hover]:ring-2` → `["md", "[&:hover]"]` and `ring-2`. */
function splitVariants(token: string): { variants: string[]; utility: string } {
  const variants: string[] = [];
  let depth = 0;
  let from = 0;
  for (let index = 0; index < token.length; index++) {
    const char = token[index];
    if (char === "[") depth++;
    else if (char === "]") depth--;
    else if (char === ":" && depth === 0) {
      variants.push(token.slice(from, index));
      from = index + 1;
    }
  }
  return { variants, utility: token.slice(from) };
}

function widthlessFocusRings(literal: string): string[] {
  const colours: { token: string; variants: string[]; kind: string }[] = [];
  const widths: { variants: string[]; kind: string }[] = [];
  for (const token of literal.split(/[\s"'`(),]+/)) {
    const { variants, utility } = splitVariants(token);
    const ring = RING_UTILITY.exec(utility);
    if (!ring) continue;
    const [, kind, rest] = ring;
    if (rest === undefined || RING_WIDTH.test(rest)) {
      if (rest === undefined || !ZERO_WIDTH.test(rest)) {
        widths.push({ variants, kind });
      }
    } else if (
      variants.some((variant) => FOCUS_STATE.test(variant)) &&
      !rest.startsWith("offset") &&
      rest !== "inset"
    ) {
      colours.push({ token, variants, kind });
    }
  }
  return colours
    .filter(
      (colour) =>
        !widths.some(
          (width) =>
            width.kind === colour.kind &&
            width.variants.every((variant) =>
              colour.variants.includes(variant),
            ),
        ),
    )
    .map(({ token }) => token);
}

describe("focus rings", () => {
  it("never puts a focus ring under a transition that covers box-shadow", () => {
    const violations = new Set<string>();

    for (const file of SRC_FILES) {
      if (file.ext !== ".tsx" && file.ext !== ".ts") continue;
      if (file.relSrc === SELF_SRC || file.relSrc.includes(".test.")) continue;

      for (const { at, value } of classContexts(file.text)) {
        if (!FOCUS_RING_CLASS.test(value) || !ANIMATES_SHADOW.test(value)) {
          continue;
        }
        const line = file.text.slice(0, at).split("\n").length;
        violations.add(
          `${file.relSrc}:${line}: ${value.match(ANIMATES_SHADOW)?.[0]}`,
        );
      }
    }

    expect([...violations], [...violations].join("\n")).toEqual([]);
  });

  it("gives every focus ring colour a width", () => {
    const violations = new Set<string>();

    for (const file of SRC_FILES) {
      if (file.ext !== ".tsx" && file.ext !== ".ts") continue;
      if (file.relSrc === SELF_SRC || file.relSrc.includes(".test.")) continue;

      for (const { at, value } of outermostContexts(classContexts(file.text))) {
        for (const token of widthlessFocusRings(value)) {
          const line = file.text.slice(0, at).split("\n").length;
          violations.add(`${file.relSrc}:${line}: ${token} has no width`);
        }
      }
    }

    expect([...violations], [...violations].join("\n")).toEqual([]);
  });

  it("matches a colour only where no width of its variant applies", () => {
    expect(
      widthlessFocusRings('"outline-none focus-visible:ring-ring"'),
    ).toEqual(["focus-visible:ring-ring"]);
    expect(
      widthlessFocusRings('"focus-within:inset-ring-ring focus:ring-2"'),
    ).toEqual(["focus-within:inset-ring-ring"]);
    expect(
      widthlessFocusRings('"focus:ring-ring-halo focus-visible:ring-[3px]"'),
    ).toEqual(["focus:ring-ring-halo"]);
    expect(
      widthlessFocusRings(
        '"focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"',
      ),
    ).toEqual([]);
    expect(
      widthlessFocusRings('"ring-1 ring-border focus-visible:ring-ring"'),
    ).toEqual([]);
    expect(
      widthlessFocusRings(
        '"focus-visible:inset-ring-1 focus-visible:inset-ring-ring focus-visible:ring-[3px] focus-visible:ring-ring-halo"',
      ),
    ).toEqual([]);
  });

  it("reads zero widths, variant chains, and group and peer focus", () => {
    expect(
      widthlessFocusRings(
        '"focus-visible:ring-0 focus-visible:ring-ring focus:ring-[0px] focus:ring-ring-halo"',
      ),
    ).toEqual(["focus-visible:ring-ring", "focus:ring-ring-halo"]);
    expect(
      widthlessFocusRings(
        '"focus-visible:after:ring-ring focus-visible:md:ring-ring group-focus-visible:ring-ring peer-focus:inset-ring-ring"',
      ),
    ).toEqual([
      "focus-visible:after:ring-ring",
      "focus-visible:md:ring-ring",
      "group-focus-visible:ring-ring",
      "peer-focus:inset-ring-ring",
    ]);
    expect(
      widthlessFocusRings(
        '"after:ring-2 focus-visible:after:ring-ring md:ring-1 md:focus-visible:ring-ring group-focus-visible:ring-2 group-focus-visible:ring-ring"',
      ),
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// shell height class guards
// ---------------------------------------------------------------------------

/**
 * Header-offset shells must use rem (`4rem` / `6rem`), not fixed px.
 * Match Tailwind tight form, CSS-spaced calc, and Tailwind underscore-space form.
 *
 * Viewport heights must use `dvh`, never `svh` / `vh` / `lvh` / `h-screen`.
 * In iOS home-screen web apps WebKit reports `svh` off by the status-bar
 * height in both status-bar styles (874 vs an 812 layout viewport with the
 * default style, 812 vs 874 with black-translucent) and `vh` / `lvh` as the
 * full screen height (874) even when the layout viewport is 812. That made
 * shells 62px taller than the screen and let the whole room, composer
 * included, scroll. `dvh` matched the layout viewport in every mode measured
 * (Safari, both standalone styles).
 */
const FORBIDDEN_HEIGHT_PATTERNS = [
  { label: "100dvh-64px", re: /100dvh[\s_]*-[\s_]*64px/ },
  { label: "100dvh-96px", re: /100dvh[\s_]*-[\s_]*96px/ },
  { label: "svh unit", re: /(\d|-)svh\b/ },
  { label: "vh unit", re: /(\d|-)vh\b/ },
  { label: "lvh unit", re: /(\d|-)lvh\b/ },
  { label: "h-screen utility", re: /\b(?:min-|max-)?h-screen\b/ },
] as const;

interface ScanFile {
  rel: string;
  text: string;
}

/** Pure scan over preloaded files — used for repo walk and hit/miss fixtures. */
function findForbiddenHeaderOffsetHits(files: ScanFile[]): string[] {
  const hits: string[] = [];
  for (const { rel, text } of files) {
    // Self documents the banned patterns; skip.
    if (rel.endsWith("src-walk-guards.test.ts")) continue;

    for (const { label, re } of FORBIDDEN_HEIGHT_PATTERNS) {
      if (!re.test(text)) continue;
      hits.push(`${rel}: contains ${label}`);
    }
  }
  return hits;
}

describe("shell height class guards", () => {
  it("detects tight, spaced, and underscore calc forms", () => {
    const hits = findForbiddenHeaderOffsetHits([
      { rel: "clean.tsx", text: 'className="h-[calc(100dvh-4rem)]"' },
      {
        rel: "tight.tsx",
        text: 'className="h-[calc(100dvh-64px)]"',
      },
      {
        rel: "spaced.css",
        text: "height: calc(100dvh - 64px);",
      },
      {
        rel: "underscore.tsx",
        text: 'className="h-[calc(100dvh_-_96px)]"',
      },
      { rel: "svh-bare.tsx", text: 'className="min-h-svh max-h-svh"' },
      { rel: "svh-calc.tsx", text: 'className="h-[calc(100svh-4rem)]"' },
      { rel: "svh-percent.tsx", text: 'className="max-h-[90svh]"' },
      { rel: "vh.tsx", text: 'className="max-h-[calc(100vh-150px)]"' },
      { rel: "vh-style.tsx", text: 'style={{ minHeight: "100vh" }}' },
      { rel: "lvh.tsx", text: 'className="h-lvh"' },
      { rel: "screen.tsx", text: 'className="min-h-screen w-screen"' },
    ]);

    expect(hits).toEqual([
      "tight.tsx: contains 100dvh-64px",
      "spaced.css: contains 100dvh-64px",
      "underscore.tsx: contains 100dvh-96px",
      "svh-bare.tsx: contains svh unit",
      "svh-calc.tsx: contains svh unit",
      "svh-percent.tsx: contains svh unit",
      "vh.tsx: contains vh unit",
      "vh-style.tsx: contains vh unit",
      "lvh.tsx: contains lvh unit",
      "screen.tsx: contains h-screen utility",
    ]);
  });

  it("returns no hits for clean fixtures", () => {
    expect(
      findForbiddenHeaderOffsetHits([
        { rel: "a.tsx", text: "h-[calc(100dvh-4rem)]" },
        { rel: "b.tsx", text: "lg:h-[calc(100dvh-6rem)]" },
        { rel: "c.tsx", text: "w-svw max-w-dvw w-screen max-w-screen-lg" },
        { rel: "d.tsx", text: "h-dvh min-h-dvh max-h-[92dvh] 100dvh" },
      ]),
    ).toEqual([]);
  });

  it("bans px header offsets and non-dvh viewport heights in product code", () => {
    const hits = findForbiddenHeaderOffsetHits(
      SRC_FILES.map((file) => ({ rel: file.relWeb, text: file.text })),
    );
    expect(hits, hits.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// historic status badges
// ---------------------------------------------------------------------------

/**
 * A status badge that spins claims the work is in flight as you read it. An
 * activity feed renders `event.status`: the status someone set at that moment,
 * which a later event has usually already replaced. The claim is false there.
 *
 * Holding the glyph still was the first fix and it was the wrong one. A
 * stopped `LoaderCircle` is an arc with a gap in it and nothing else, so the
 * whole glyph means motion and at rest it reads as a rendering fault. The
 * historic form is `TaskStatusInline`: a dot, which was never moving, and the
 * status word beside it.
 *
 * Two feeds render this shape today, the task activity feed and the public
 * share view, and the second one was missed when the first was fixed. This
 * catches the third.
 *
 * Scope is deliberately narrow: a badge fed from `event.status` inside a JSX
 * element. A badge fed from `task.status` shows the status now and must keep
 * its spin, so it is not matched here.
 */
const HISTORIC_BADGE = /<TaskStatusBadge\b[\s\S]*?\/>/g;

describe("historic status badges", () => {
  it("never draws a status a later event has replaced as a live badge", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (file.ext !== ".tsx") continue;
      if (file.relSrc.endsWith(".test.tsx")) continue;

      for (const [element] of file.text.matchAll(HISTORIC_BADGE)) {
        if (!/\bevent\.status\b/.test(element)) continue;
        const line = file.text
          .slice(0, file.text.indexOf(element))
          .split("\n").length;
        violations.push(
          `${file.relSrc}:${line}: reads event.status; use TaskStatusInline`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  /**
   * Without this the guard is vacuous: delete both feeds and the regex above
   * matches nothing, which looks exactly like a pass.
   */
  it("still finds the two feeds it exists to police", () => {
    const feeds = SRC_FILES.filter((file) => {
      if (file.ext !== ".tsx") return false;
      return (
        /<TaskStatusInline\b/.test(file.text) &&
        /\bevent\.status\b/.test(file.text)
      );
    });

    expect(feeds.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// icon touch targets
// ---------------------------------------------------------------------------

/**
 * DESIGN.md → Accessibility → Touch targets: an icon-only control is at least
 * `size-10` (40px) below `md` and `size-8` (32px) from `md` up, either as its
 * own box or through the `hit-area` utility. `size="icon"` is `size-10`, so a
 * `size-N` override is what shrinks one.
 *
 * Checked: the opening tag of any component given `size="icon"` (`Button`
 * and wrappers such as `TaskShareButton`). A `size-N` that applies below `md`
 * (bare, `sm:`, `max-md:`, a container query or any non-breakpoint variant)
 * must be at least 10; one behind `md:`, `lg:`, `xl:` or `2xl:` at least 8.
 * `hit-area` exempts the tag. An older `after:`/`before:` `-inset-N`
 * pseudo-element counts only for the size it reaches (see `pseudoInsets`).
 *
 * Not checked, because a regex over one tag cannot see it:
 *   - classes that arrive through a variable or constant
 *     (`className={TOOL_CLASS}`, `buttonClassName` handed to a child)
 *   - bespoke `<button>`s, `asChild` children and links, which carry no
 *     `size="icon"` to say they are icon-only
 *   - `h-N w-N` or arbitrary `size-[…]` boxes
 *   - whether a `hit-area` overlaps a neighbouring target; that is spacing,
 *     and stays a review call
 */
const SIZE_ICON_PROP = /\bsize=(?:"icon"|\{["']icon["']\})/;
const SIZE_TOKEN =
  /(?<![\w:[\]-])((?:[^\s"'`]+:)?)size-(\d+(?:\.\d+)?)(?![\w.[-])/g;
const DESKTOP_VARIANT = /(?:^|:)(?:md|lg|xl|2xl):$/;

/**
 * Every `<Component …>` opening tag, braces and quotes balanced, reduced to
 * its own attributes: a `{…}` value that holds JSX (a render prop, an `icon`
 * element) is dropped, so a nested `<Button size="icon">` is checked as its
 * own tag and not also as part of the one around it.
 */
function openingTags(
  text: string,
  name: RegExp = /<[A-Z][\w.]*(?![\w.])/g,
): { tag: string; index: number; end: number }[] {
  const tags: { tag: string; index: number; end: number }[] = [];
  for (const match of text.matchAll(name)) {
    let depth = 0;
    let quote: string | null = null;
    let own = match[0];
    let braceStart = 0;
    let i = match.index + match[0].length;
    for (; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (char === "\\") i++;
        else if (char === quote) quote = null;
      } else if (depth > 0 && text.startsWith("//", i)) {
        // A comment in a prop (`section's`) would otherwise open a string.
        const end = text.indexOf("\n", i);
        i = end === -1 ? text.length : end - 1;
        continue;
      } else if (depth > 0 && text.startsWith("/*", i)) {
        const end = text.indexOf("*/", i);
        i = end === -1 ? text.length : end + 1;
        continue;
      } else if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{" && depth++ === 0) braceStart = i;
      else if (char === "}" && --depth === 0) {
        const value = text.slice(braceStart, i + 1);
        own += /<[A-Za-z]/.test(value) ? "{}" : value;
        continue;
      } else if (char === ">" && depth === 0 && text[i - 1] !== "=") break;
      if (depth === 0) own += char;
    }
    tags.push({ tag: `${own}>`, index: match.index, end: i + 1 });
  }
  return tags;
}

/**
 * An older `after:`/`before:` `-inset-N` expansion counts for what it adds:
 * the target is the box plus the inset on both sides, so `size-8` with
 * `after:-inset-1.5` is 8 + 2 × 1.5 = 11 steps (44px). A `md:` inset
 * replaces the base one from md up, and `md:after:hidden` drops it there.
 */
const PSEUDO_INSET =
  /(?<![\w:[\]-])((?:[^\s"'`]+:)?)(?:after|before):-inset-(\d+(?:\.\d+)?)(?![\w.[-])/g;

function pseudoInsets(tag: string): { mobile: number; desktop: number } {
  let mobile = 0;
  let desktop: number | null = null;
  for (const [, variant, n] of tag.matchAll(PSEUDO_INSET)) {
    if (DESKTOP_VARIANT.test(variant)) desktop = Number(n);
    else mobile = Math.max(mobile, Number(n));
  }
  if (desktop === null) {
    desktop = /md:(?:after|before):hidden/.test(tag) ? 0 : mobile;
  }
  return { mobile, desktop };
}

function smallIconTargets(rel: string, text: string): string[] {
  const hits: string[] = [];
  for (const { tag, index } of openingTags(text)) {
    if (!SIZE_ICON_PROP.test(tag)) continue;
    if (/(?<![\w-])hit-area(?![\w-])/.test(tag)) continue;
    const sizes = [...tag.matchAll(SIZE_TOKEN)];
    const mobileSizes = sizes.filter(([, v]) => !DESKTOP_VARIANT.test(v));
    const desktopSizes = sizes.filter(([, v]) => DESKTOP_VARIANT.test(v));
    const inset = pseudoInsets(tag);
    // A bare size still applies from md up when no `md:` size replaces it.
    const small = new Set([
      ...mobileSizes.filter(([, , n]) => Number(n) + 2 * inset.mobile < 10),
      ...(desktopSizes.length ? desktopSizes : mobileSizes).filter(
        ([, , n]) => Number(n) + 2 * inset.desktop < 8,
      ),
    ]);
    if (small.size === 0) continue;
    const line = text.slice(0, index).split("\n").length;
    hits.push(
      `${rel}:${line}: ${[...small].map(([token]) => token).join(" ")}`,
    );
  }
  return hits;
}

describe("icon touch targets", () => {
  it("gives every size=icon control 40px below md and 32px from md up", () => {
    const hits = SRC_FILES.filter(
      (file) => file.ext === ".tsx" && !file.relSrc.endsWith(".test.tsx"),
    ).flatMap((file) => smallIconTargets(file.relSrc, file.text));

    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("catches the shapes it exists to catch", () => {
    const fixtures = [
      '<Button size="icon" className="size-8">',
      '<Button size="icon" className="size-8 md:size-7">',
      '<Button size="icon" className="size-9 rounded-full sm:size-7">',
      '<Button size="icon" className="size-10 md:size-7">',
      '<Button\n  size="icon"\n  onClick={() => { go(); }}\n  className={cn("size-6", on && "bg-muted")}\n>',
      '<TaskShareButton size="icon" className="size-7" />',
      '<Button size="icon" className="size-8 after:absolute after:-inset-1.5 md:size-7 md:after:hidden">',
      '<Button size="icon" className="size-7 after:absolute after:-inset-px">',
      '<Button size="icon" className="size-7 after:absolute after:-inset-0.5">',
      '<Button size="icon" className="size-6 after:absolute after:-inset-2 md:after:hidden">',
      '<Button\n  size="icon"\n  className={cn(\n    // the section\'s `+` column\n    "size-8 after:absolute after:-inset-px",\n  )}\n>',
    ];
    for (const fixture of fixtures) {
      expect(smallIconTargets("f.tsx", fixture), fixture).toHaveLength(1);
    }
  });

  it("passes the shapes the rule allows", () => {
    const fixtures = [
      '<Button size="icon">',
      '<Button size="icon" className="size-10 md:size-8">',
      '<Button size="icon" className="size-11 lg:size-8">',
      '<Button size="icon" className="hit-area size-6">',
      '<Button size="icon" className="relative size-8 after:absolute after:-inset-1.5 md:size-7 md:after:-inset-0.5">',
      '<Button size="icon" className="size-6 after:absolute after:-inset-2">',
      '<Button size="sm" className="size-8">',
      '<Button size="icon"><X className="size-4" /></Button>',
    ];
    for (const fixture of fixtures) {
      expect(smallIconTargets("f.tsx", fixture), fixture).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// chip remove targets
// ---------------------------------------------------------------------------

/**
 * DESIGN.md → Accessibility → Touch targets → Chips: a chip's remove is
 * `ChipRemoveButton`, whose box is the 40px target below `md`, so nothing
 * reaches into the next row of a wrapping list.
 *
 * Checked:
 *   - a `<Badge>` holds no bespoke `<button>`. `Badge` is `overflow-hidden`,
 *     so a `hit-area` inside one is clipped to the badge; its remove is
 *     `ChipRemoveButton` on a badge given `overflow-visible py-0 pe-0`.
 *   - a bespoke `<button>` whose only child is a lucide `<X />` carries
 *     `hit-area`, or a bare `size-10` / `h-10` that makes its box the target
 *     and no `md:`-and-up `size-N` / `h-N` below 8 that shrinks it again.
 *
 * Not checked, because a regex over one tag cannot see it:
 *   - classes that arrive through a variable or constant
 *   - a dismiss built from another icon, or with a label beside the `X`
 *   - whether the chip around a `ChipRemoveButton` dropped its padding and
 *     overflow, or whether a `hit-area` overlaps a target in the next row;
 *     that is spacing, and stays a review call
 */
const BARE_X_CHILD = /^\s*<X\b[^<>]*\/>\s*$/;
const DISMISS_HIT_AREA = /(?<![\w:-])hit-area(?![\w-])/;
const DISMISS_BOX = /(?<![\w:[\]-])(?:size|h)-10(?![\w.[-])/;
const DISMISS_DESKTOP_BOX =
  /(?<![\w:[\]-])(?:md|lg|xl|2xl):(?:size|h)-(\d+(?:\.\d+)?)(?![\w.[-])/g;

function smallDismissTargets(rel: string, text: string): string[] {
  const hits: string[] = [];
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  for (const { tag, index, end } of openingTags(text, /<Badge(?![\w.])/g)) {
    if (tag.endsWith("/>")) continue;
    const close = text.indexOf("</Badge>", end);
    if (close !== -1 && /<button(?![\w.-])/.test(text.slice(end, close))) {
      hits.push(`${rel}:${lineOf(index)}: <button> inside <Badge>`);
    }
  }
  for (const { tag, index, end } of openingTags(text, /<button(?![\w.-])/g)) {
    const close = text.indexOf("</button>", end);
    if (close === -1 || !BARE_X_CHILD.test(text.slice(end, close))) continue;
    if (DISMISS_HIT_AREA.test(tag)) continue;
    const desktopSmall = [...tag.matchAll(DISMISS_DESKTOP_BOX)].some(
      ([, n]) => Number(n) < 8,
    );
    if (DISMISS_BOX.test(tag) && !desktopSmall) continue;
    hits.push(`${rel}:${lineOf(index)}: <X /> button without hit-area`);
  }
  return hits;
}

describe("chip remove targets", () => {
  it("gives every bespoke X button and badge remove a full target", () => {
    const hits = SRC_FILES.filter(
      (file) => file.ext === ".tsx" && !file.relSrc.endsWith(".test.tsx"),
    ).flatMap((file) => smallDismissTargets(file.relSrc, file.text));

    expect(hits, hits.join("\n")).toEqual([]);
  });

  it("catches the shapes it exists to catch", () => {
    const fixtures = [
      '<Badge className="gap-1">\n  {name}\n  <button type="button" className="hit-area" onClick={remove}>\n    <X className="size-3" />\n  </button>\n</Badge>',
      '<button\n  type="button"\n  className="rounded-sm p-0.5"\n  onClick={() => remove(tag)}\n>\n  <X className="size-3" aria-hidden />\n</button>',
      '<button type="button" className="size-5 md:h-10"><X className="size-3" /></button>',
      '<button type="button" className="size-10 md:size-5"><X className="size-3" /></button>',
    ];
    for (const fixture of fixtures) {
      expect(smallDismissTargets("f.tsx", fixture), fixture).toHaveLength(1);
    }
  });

  it("passes the shapes the rule allows", () => {
    const fixtures = [
      '<Badge className="gap-1 overflow-visible py-0 pe-0">\n  {name}\n  <ChipRemoveButton aria-label={label} onClick={remove} />\n</Badge>',
      '<Badge variant="outline">{name}</Badge>',
      '<button type="button" className="hit-area rounded p-1"><X className="size-4" /></button>',
      '<button type="button" className="h-10 w-full md:h-8"><X className="size-3" /></button>',
      '<button type="button" className="p-1"><X className="size-3" /> Clear</button>',
    ];
    for (const fixture of fixtures) {
      expect(smallDismissTargets("f.tsx", fixture), fixture).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// DESIGN.md
// ---------------------------------------------------------------------------

/**
 * `apps/web/DESIGN.md` is what agents read before they style anything, so a
 * token it names that `globals.css` no longer defines sends them to a utility
 * that emits nothing. The doc once listed `--destructive/warning/success/info`
 * long after the family became `--semantic-*` and `info` was retired.
 *
 * Only whole names are checked, so write every token out in full: a shorthand
 * like that one, `--chart-N-quinary` or `--animate-*` reads as prose and slips
 * past.
 */
const DESIGN_MD = readFileSync(path.join(WEB_ROOT, "DESIGN.md"), "utf8");

const DOC_TOKEN = /--[a-z][a-z0-9-]*[a-z0-9](?![\w*…-])/g;
const DOC_LINK = /\]\((?!https?:|#)([^)\s]+)\)/g;

describe("DESIGN.md", () => {
  const stylesheet = readFileSync(
    path.join(SRC_ROOT, "app/globals.css"),
    "utf8",
  );
  const named = [...new Set(DESIGN_MD.match(DOC_TOKEN) ?? [])];

  it("names only tokens globals.css defines", () => {
    const undefinedTokens = named.filter(
      (token) => !new RegExp(`^\\s*${token}\\s*:`, "m").test(stylesheet),
    );

    expect(undefinedTokens, undefinedTokens.join(", ")).toEqual([]);
  });

  /** Without this the check above passes vacuously if the scan finds nothing. */
  it("still finds the tokens it exists to check", () => {
    expect(named).toContain("--semantic-destructive");
    expect(named.length).toBeGreaterThan(20);
  });

  it("links only to files that exist", () => {
    const broken = [...DESIGN_MD.matchAll(DOC_LINK)]
      .map((match) => match[1])
      .filter((target) => {
        try {
          statSync(path.resolve(WEB_ROOT, target));
          return false;
        } catch {
          return true;
        }
      });

    expect(broken).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// instant navigation routes
// ---------------------------------------------------------------------------

/**
 * With `cacheComponents` and `partialPrefetching` on, a route that reads
 * `params` or `searchParams` above its own `<Suspense>` cannot produce a
 * static shell, so Next reports `instant-shell-url-data` on every navigation.
 * Each such route needs a decision: block on purpose with
 * `export const instant = false`, or hand the promise to a Suspense-wrapped
 * child so the shell stays URL-independent.
 *
 * `instant` is read per segment. A layout's `instant = false` makes the route
 * allowed to block, but it does NOT cover the pages beneath it for URL-data
 * validation — that asymmetry is deliberate (it is what lets a blocking
 * layout host instant pages), so each page repeats the export.
 *
 * This guard keys on the PROP DECLARATION, not on how the promise is later
 * awaited. An earlier sweep grepped for `await params` / `await searchParams`
 * and silently missed `await Promise.all([params, searchParams])` and a
 * promise handed to a helper (`await readSearchParams(searchParams)`),
 * which left five blocking pages without an opt-out.
 */
const URL_DATA_PROP = /(?:^|[\s,{(])(?:params|searchParams)\s*:\s*Promise</m;

/**
 * The page export forwards its URL-data promise into a Suspense-wrapped
 * child, so the shell above the boundary reads nothing from the URL. These
 * are the shape the worklist below is migrating toward; see
 * `(app)/tasks/(root)/page.tsx` for the reference implementation.
 */
const SUSPENSE_WRAPPED = new Set([
  "(app)/admin/enterprise-contracts/page.tsx",
  "(app)/drive/files/[resourceId]/page.tsx",
  "(app)/agents/[agentId]/jobs/layout.tsx",
  "(app)/chat/rooms/[roomId]/page.tsx",
  "(app)/projects/(root)/page.tsx",
  "(app)/schedules/[scheduleId]/page.tsx",
  "(app)/schedules/page.tsx",
  "(app)/tasks/(root)/page.tsx",
]);

/**
 * In-app destinations that still read URL data above their boundary. These
 * are where an App Shell actually pays off, so they want the Suspense
 * treatment rather than an opt-out — follow
 * `apps/web/.agents/skills/next-partial-prefetching-adoption` step 5, feature
 * by feature, and delete each entry as it moves to SUSPENSE_WRAPPED.
 *
 * Shrink this list. Do not add to it: a new route picks a side on day one.
 */
const INSTANT_WORKLIST = new Set([
  "(app)/(welcome)/page.tsx",
  "(app)/agents/[agentId]/jobs/@modal/[jobId]/page.tsx",
  "(app)/agents/[agentId]/jobs/@right/[jobId]/page.tsx",
  "(app)/agents/[agentId]/jobs/@right/page.tsx",
  "(app)/agents/[agentId]/page.tsx",
  "(app)/billing/page.tsx",
  "(app)/calendar/page.tsx",
  "(app)/chat/invites/[id]/page.tsx",
  "(app)/chat/join/[token]/page.tsx",
  "(app)/chat/page.tsx",
  "(app)/connections/page.tsx",
  "(app)/developer/coworkers/[id]/page.tsx",
  "(app)/developer/page.tsx",
  "(app)/developer/tasks/[taskId]/page.tsx",
  "(app)/developer/vendors/[id]/page.tsx",
  "(app)/history/page.tsx",
  "(app)/organizations/[organizationSlug]/design-md/edit/page.tsx",
  "(app)/organizations/[organizationSlug]/page.tsx",
  "(app)/projects/[projectId]/@modal/(.)edit/page.tsx",
  "(app)/projects/[projectId]/design-md/edit/page.tsx",
  "(app)/projects/[projectId]/edit/page.tsx",
  "(app)/projects/[projectId]/layout.tsx",
  "(app)/projects/[projectId]/page.tsx",
  "(app)/tasks/[taskId]/@modal/(.)edit/page.tsx",
  "(app)/tasks/[taskId]/edit/page.tsx",
  "(app)/tasks/[taskId]/page.tsx",
]);

/**
 * URL data read only by `generateMetadata`, never by the default export.
 * That is a different insight — `blocking-prerender-metadata-runtime`, not
 * `instant-shell-url-data` — and neither fix above applies to it: metadata
 * cannot be wrapped in the page's `<Suspense>`, and `instant = false` does
 * not quiet it. The documented fixes are a static `metadata` export or a
 * `connection()` marker rendered inside `<Suspense>` on the page.
 *
 * Keep these separate so the worklist above stays an honest count of routes
 * that the Suspense treatment can actually fix.
 */
const METADATA_ONLY = new Set(["(app)/agents/[agentId]/layout.tsx"]);

const ROUTE_FILE_NAMES = new Set(["page.tsx", "layout.tsx"]);

interface RouteFile {
  rel: string;
  readsUrlData: boolean;
  optsOut: boolean;
  hasSuspense: boolean;
}

function routeFiles(): RouteFile[] {
  return SRC_FILES.flatMap((file) => {
    if (!ROUTE_FILE_NAMES.has(path.basename(file.relSrc))) return [];
    if (file.relApp == null) return [];
    return [
      {
        rel: file.relApp,
        readsUrlData: URL_DATA_PROP.test(file.text),
        optsOut: /^export const instant\s*=\s*false/m.test(file.text),
        hasSuspense: /<Suspense/.test(file.text),
      },
    ];
  });
}

describe("instant navigation routes", () => {
  it("gives every route that reads URL data a decision", () => {
    const undecided = routeFiles()
      .filter(
        (file) =>
          file.readsUrlData &&
          !file.optsOut &&
          !SUSPENSE_WRAPPED.has(file.rel) &&
          !INSTANT_WORKLIST.has(file.rel) &&
          !METADATA_ONLY.has(file.rel),
      )
      .map((file) => file.rel);

    expect(undecided).toEqual([]);
  });

  it("keeps the worklist free of routes that no longer belong on it", () => {
    const files = routeFiles();
    const byRel = new Map(files.map((file) => [file.rel, file]));
    const stale: string[] = [];

    for (const rel of [
      ...SUSPENSE_WRAPPED,
      ...INSTANT_WORKLIST,
      ...METADATA_ONLY,
    ]) {
      const file = byRel.get(rel);
      if (!file) {
        stale.push(`${rel}: listed but no longer a route file`);
        continue;
      }
      if (!file.readsUrlData) {
        stale.push(`${rel}: listed but no longer reads params/searchParams`);
        continue;
      }
      if (file.optsOut) {
        stale.push(`${rel}: listed but now exports instant = false`);
      }
    }

    // A file on the migrated list that lost its boundary is the one rot case
    // the checks above miss: it still reads URL data and still has no
    // `instant` export, so it looks settled while it is back to blocking.
    for (const rel of SUSPENSE_WRAPPED) {
      if (byRel.get(rel)?.hasSuspense === false) {
        stale.push(`${rel}: listed as suspense-wrapped but has no <Suspense>`);
      }
    }

    expect(stale).toEqual([]);
  });

  it("matches URL data however the promise is later awaited", () => {
    // The shapes that defeated the `await params` grep this guard replaces.
    const matches = [
      "  params: Promise<{ id: string }>;",
      "  searchParams: Promise<{ tab?: string }>;",
      "export default async function P({ params }: { params: Promise<Q> }) {",
      "interface Props { params: Promise<X>; searchParams: Promise<Y> }",
    ];
    for (const line of matches) {
      expect(URL_DATA_PROP.test(line), line).toBe(true);
    }

    const nonMatches = [
      "const params = new URLSearchParams();",
      "const searchParams = useSearchParams();",
      "type Params = Promise<{ id: string }>;",
    ];
    for (const line of nonMatches) {
      expect(URL_DATA_PROP.test(line), line).toBe(false);
    }
  });
});
