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
const FONT_SIZES = "xs|sm|base|lg|xl|[2-9]xl";

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
      if (file.relSrc.startsWith("lib/clients/generated/")) continue;
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
// no fixed px font sizes
// ---------------------------------------------------------------------------

/** Paths relative to apps/web/src that may keep px font sizes (non-product UI). */
const FONT_SIZE_ALLOWLIST = new Set(["app/api/export/pdf/route.ts"]);

// Decimal px allowed in the pattern (e.g. text-[10.5px]). Intentional limits:
// does not scan template assignments like root.style.fontSize = `${n}px`.
const TEXT_PX_CLASS = /text-\[\d+(?:\.\d+)?px\]/;
const FONT_SIZE_PX = /font-size:\s*\d+(?:\.\d+)?px/i;
const FONT_SIZE_STYLE_NUM = /fontSize:\s*\d+(?:\.\d+)?\b/;
const FONT_SIZE_STYLE_PX = /fontSize:\s*["']\d+(?:\.\d+)?px["']/;

describe("no fixed px font sizes in product UI", () => {
  it("has no text-[Npx], font-size: Npx, or fontSize: N outside allowlist", () => {
    const violations: string[] = [];

    for (const file of SRC_FILES) {
      if (FONT_SIZE_ALLOWLIST.has(file.relSrc)) continue;
      // Self + apply unit tests mock { fontSize: "28px" } style objects.
      if (file.relSrc.endsWith("src-walk-guards.test.ts")) continue;
      if (file.relSrc.endsWith("dynamic-type.test.ts")) continue;

      file.lines.forEach((line, i) => {
        if (
          TEXT_PX_CLASS.test(line) ||
          FONT_SIZE_PX.test(line) ||
          FONT_SIZE_STYLE_NUM.test(line) ||
          FONT_SIZE_STYLE_PX.test(line)
        ) {
          violations.push(`${file.relSrc}:${i + 1}: ${line.trim()}`);
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
      if (file.relSrc.startsWith("lib/clients/generated/")) continue;
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
 * promise handed to a helper (`await getRedirectQueryString(searchParams)`),
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
  "(app)/agents/[agentId]/jobs/layout.tsx",
  "(app)/chat/rooms/[roomId]/page.tsx",
  "(app)/projects/(root)/page.tsx",
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
  "(app)/projects/[projectId]/calendar/page.tsx",
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
