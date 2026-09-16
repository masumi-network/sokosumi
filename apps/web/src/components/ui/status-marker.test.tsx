import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import { getJobStatusMarker } from "@/components/jobs/job-status-styles";
import {
  STATUS_ROLE_STYLES,
  StatusMarker,
  type StatusRole,
} from "@/components/ui/status-marker";
import { SokosumiJobStatus, TaskStatus } from "@/lib/clients/generated/core";

const ROLES = Object.keys(STATUS_ROLE_STYLES) as StatusRole[];

const GLOBALS_CSS = readFileSync(
  join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function block(selector: string): string {
  const start = GLOBALS_CSS.indexOf(selector);
  return GLOBALS_CSS.slice(start, GLOBALS_CSS.indexOf("\n}", start));
}

const THEMES = {
  light: block(":root {"),
  dark: block(".dark {"),
} as const;
const BRIDGES = block("@theme inline {");

/** The token a colour utility reads: `bg-status-working` -> `status-working`. */
function tokenOf(utility: string): string {
  return utility.replace(/^(bg|text)-/, "");
}

function declaredValue(theme: string, token: string): string {
  const match = theme.match(
    new RegExp(`--${token}:\\s*hsla\\(([^)]*)\\)`),
  );
  if (!match) throw new Error(`--${token} is not declared in this theme`);
  return match[1];
}

/** sRGB relative luminance, WCAG 2.1 definition. */
function luminance(hsla: string): number {
  const [h, s, l] = hsla
    .split(",")
    .slice(0, 3)
    .map((part) => Number.parseFloat(part));
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(theme: string, a: string, b: string): number {
  const [x, y] = [luminance(declaredValue(theme, a)), luminance(declaredValue(theme, b))];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}


describe("status role styles", () => {
  /**
   * The dot used to be derived from the marker by rewriting `text-` to `bg-`.
   * That works for every role whose marker is the colour of the glyph, and
   * breaks for the one role whose marker is the colour of a label sitting on a
   * solid fill: `failure` produced `bg-semantic-destructive-foreground`, a
   * near-white dot measuring 1.06:1 on --card-background.
   */
  it.each(ROLES)("gives %s a dot that is not a label colour", (role) => {
    expect(STATUS_ROLE_STYLES[role].dot).not.toMatch(/-foreground$/);
    expect(STATUS_ROLE_STYLES[role].dot.startsWith("bg-")).toBe(true);
  });

  /**
   * `onSurface` is the same colour as `dot` and the same reasoning, written as
   * a text colour for the compact badge, which paints an svg by
   * `currentColor` and so cannot use a `bg-` class. The two fields are spelled
   * out separately on purpose, because deriving one from the other by string
   * surgery is what produced the invisible failure dot. This pins the pairing
   * without reintroducing the derivation: a hand edit of either field on any
   * role fails here.
   */
  it.each(ROLES)("gives %s an onSurface twin of its dot", (role) => {
    const { dot, onSurface } = STATUS_ROLE_STYLES[role];

    expect(onSurface).toBe(dot.replace("bg-", "text-"));
    expect(onSurface).not.toMatch(/-foreground$/);
  });

  /**
   * The marker token is tuned to 3:1, which is all WCAG 2.2 SC 1.4.11 asks of
   * a glyph. The badge label is 12px text and needs 4.5:1 on the same fill, so
   * every tinted role reads its label from a dedicated `-label` step. Reusing
   * the marker token here looks right and fails contrast on several roles, so
   * the pairing is pinned instead of left to review.
   */
  it.each(ROLES)("gives %s a label colour matched to its fill", (role) => {
    const { bg, text, marker } = STATUS_ROLE_STYLES[role];

    if (!bg.endsWith("-quaternary")) {
      // A solid fill carries its own foreground.
      expect(text).toMatch(/-foreground$/);
      return;
    }

    expect(text).toBe(
      bg === "bg-quaternary" ? "text-foreground" : `${marker}-label`,
    );
  });

  /**
   * A colour token becomes a utility only through a `--color-*` bridge in
   * `@theme inline`. Without one the class emits no CSS at all, the badge
   * silently inherits, and every string-comparing test stays green. Five
   * label tokens read through this seam, so the seam is pinned here.
   */
  it.each(ROLES)("bridges every token %s paints with", (role) => {
    const { bg, text, marker, dot, onSurface } = STATUS_ROLE_STYLES[role];

    // `dot` and `onSurface` are listed so a future role whose dot names a
    // token no other field paints cannot slip through unbridged. Today every
    // dot token is already named by `bg` or `marker`, so they add no coverage
    // yet.
    for (const token of [bg, text, marker, dot, onSurface].map(tokenOf)) {
      // The formatter wraps the longer bridges across lines.
      const bridge = new RegExp(
        `--color-${token}:\\s*var\\(\\s*--${token},?\\s*\\)`,
      );

      expect(bridge.test(BRIDGES), `--color-${token} has no bridge`).toBe(true);
      expect(() => declaredValue(THEMES.light, token)).not.toThrow();
      expect(() => declaredValue(THEMES.dark, token)).not.toThrow();
    }
  });

  /**
   * The reason the label reads from its own step rather than from the marker.
   * Badge text is `text-xs`, so it is normal text and WCAG 2.2 SC 1.4.3 asks
   * 4.5:1; the glyph is a non-text graphic and SC 1.4.11 asks 3:1. The
   * numbers are measured from the stylesheet, so retuning a hue and forgetting
   * its label fails here instead of shipping.
   */
  it.each(ROLES)("keeps %s legible on its own fill in both themes", (role) => {
    const { bg, text, marker } = STATUS_ROLE_STYLES[role];

    for (const theme of [THEMES.light, THEMES.dark]) {
      expect(contrast(theme, tokenOf(bg), tokenOf(text))).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(
        contrast(theme, tokenOf(bg), tokenOf(marker)),
      ).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * The bare dot is painted on a surface, not on a role fill, so the fill
   * test above cannot see it. It is a non-text graphic, so SC 1.4.11 asks
   * 3:1. The surface measured here is --card-background, the resting card.
   * List rows use --muted on hover, where the dark `failure` mark reaches
   * only 2.78; that exception is recorded on `RoleStyle.dot`. Only `dot` is
   * measured, because "gives %s an onSurface twin of its dot" pins the other
   * one to it.
   */
  it.each(ROLES)("keeps the %s mark visible on the card surface", (role) => {
    for (const theme of [THEMES.light, THEMES.dark]) {
      const dot = tokenOf(STATUS_ROLE_STYLES[role].dot);

      expect(contrast(theme, "card-background", dot)).toBeGreaterThanOrEqual(3);
    }
  });

  it("paints the failure dot with the solid fill, not its label", () => {
    expect(STATUS_ROLE_STYLES.failure.dot).toBe("bg-semantic-destructive-solid");
  });
});

/**
 * Colour says what the reader must do and the glyph says which status it is,
 * so two statuses that share a role must not share a glyph. Without this,
 * collapsing several statuses onto one icon would leave badges that are
 * identical in both channels, which is the failure WCAG 2.2 SC 1.4.1 is
 * about.
 */
describe("glyph identity", () => {
  it("gives every task status in a role its own glyph", () => {
    const seen = new Map<string, string>();
    for (const status of Object.values(TaskStatus)) {
      const { role, icon } = getTaskStatusMarker(status);
      const key = `${role}:${icon.displayName ?? icon.name}`;
      expect(seen.has(key), `${status} shares ${key} with ${seen.get(key)}`).toBe(
        false,
      );
      seen.set(key, status);
    }
  });

  /**
   * One pair shares a glyph on purpose. PAYMENT_PENDING and STARTED are one
   * stage seen twice, and to the reader it is one stage, so the badge is meant
   * to look the same in both. Their labels are what tell them apart, and
   * job-status-label.test.ts pins those as distinct.
   *
   * The assertion is an equality, not an allowlist membership, so it fails in
   * both directions: a new collision fails, and separating this pair fails
   * too. Splitting them is a design decision, not a refactor, and it should
   * have to come here and say so.
   */
  it("gives every job status its own glyph, bar one deliberate pair", () => {
    const byGlyph = new Map<string, SokosumiJobStatus[]>();
    for (const status of Object.values(SokosumiJobStatus)) {
      const { role, icon } = getJobStatusMarker(status);
      const key = `${role}:${icon.displayName ?? icon.name}`;
      byGlyph.set(key, [...(byGlyph.get(key) ?? []), status]);
    }

    const shared = [...byGlyph.values()]
      .filter((group) => group.length > 1)
      .map((group) => [...group].sort());

    expect(shared).toEqual([
      [SokosumiJobStatus.PAYMENT_PENDING, SokosumiJobStatus.STARTED].sort(),
    ]);
  });
});

describe("StatusMarker", () => {
  it("renders the role's marker colour and hides the glyph from readers", () => {
    const spec = getTaskStatusMarker(TaskStatus.FAILED);
    const { container } = render(<StatusMarker spec={spec} />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveClass("size-3.5", STATUS_ROLE_STYLES[spec.role].marker);
    expect(svg).toHaveAttribute("aria-hidden");
  });

  it("spins only the running glyph", () => {
    const running = render(
      <StatusMarker spec={getTaskStatusMarker(TaskStatus.RUNNING)} />,
    );
    expect(running.container.querySelector("svg")).toHaveClass("animate-spin");

    const draft = render(
      <StatusMarker spec={getTaskStatusMarker(TaskStatus.DRAFT)} />,
    );
    expect(draft.container.querySelector("svg")).not.toHaveClass("animate-spin");
  });
});
