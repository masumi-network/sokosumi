import { readFileSync } from "node:fs";
import { join } from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import { COLUMN_TASK_STATUSES } from "@/app/tasks/utils/task-column";
import { FILE_STATUS_MARKERS } from "@/components/tasks/task-file-status-badge";
import { getJobStatusMarker } from "@/components/jobs/job-status-styles";
import {
  getToneStyle,
  StatusMarker,
  type StatusHue,
  type StatusTone,
  type StatusWeight,
} from "@/components/ui/status-marker";
import { SokosumiJobStatus, TaskStatus } from "@/lib/clients/generated/core";

const HUES: StatusHue[] = [
  "dormant",
  "staged",
  "active",
  "blocked",
  "resolved",
  "fault",
];
const WEIGHTS: StatusWeight[] = ["filled", "outline", "solid"];

/**
 * Every tone the scales actually paint, so nothing untested ships.
 *
 * All three scales, not two. The file badge is the one that is easy to
 * forget: it has no test of its own, and while it was left out, the contrast,
 * bridge and dot guards below simply did not run on any tone only it paints.
 */
const TONES_IN_USE: StatusTone[] = (() => {
  const seen = new Map<string, StatusTone>();
  const add = (tone: StatusTone) => seen.set(`${tone.hue}:${tone.weight}`, tone);

  for (const status of Object.values(TaskStatus)) {
    add(getTaskStatusMarker(status).tone);
  }
  for (const status of Object.values(SokosumiJobStatus)) {
    add(getJobStatusMarker(status).tone);
  }
  for (const spec of Object.values(FILE_STATUS_MARKERS)) {
    add(spec.tone);
  }
  return [...seen.values()];
})();

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
  return utility.replace(/^(bg|text|border)-/, "");
}

/** The colour utilities inside a class string, ignoring `*-transparent`. */
function utilitiesIn(classes: string): string[] {
  return classes
    .split(/\s+/)
    .filter((entry) => entry.length > 0 && !entry.endsWith("-transparent"));
}

function declaredValue(theme: string, token: string): string {
  const match = theme.match(new RegExp(`--${token}:\\s*hsla\\(([^)]*)\\)`));
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
  const [x, y] = [
    luminance(declaredValue(theme, a)),
    luminance(declaredValue(theme, b)),
  ];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function toneName(tone: StatusTone): string {
  return `${tone.hue}/${tone.weight}`;
}

/**
 * Rule 1 of the model, pinned against the board's own grouping rather than
 * against a copy of it. `task-column.ts` is the single source of truth for
 * which column a status sits in; this says the badge must agree.
 *
 * `done` is the documented exception. Its three members are outcomes and the
 * outcome is the point of that column, so it carries three hues.
 */
const COLUMN_HUE: Record<string, StatusHue> = {
  backlog: "dormant",
  todo: "staged",
  "in-progress": "active",
  "input-required": "blocked",
};

/**
 * The second exception, and unlike `done` a temporary one. `QUEUED` sits in
 * `backlog` and wears `staged`, the hue of the todo column, because a
 * scheduled task is waiting to start with the start already arranged and
 * nothing else in backlog is. The board is due to stop showing these rows at
 * all and point the reader at the schedules surface (SOK-1112); when that
 * lands this entry goes with it.
 *
 * It is an allowlist rather than a loosened rule on purpose: every other
 * status in `backlog` still has to take the column's hue, so a second drift
 * fails here.
 */
const COLUMN_HUE_EXCEPTIONS: Partial<Record<TaskStatus, StatusHue>> = {
  [TaskStatus.QUEUED]: "staged",
};

describe("hue follows the board column", () => {
  it.each(Object.keys(COLUMN_HUE))(
    "paints every status in %s with that column's hue",
    (columnId) => {
      const statuses = COLUMN_TASK_STATUSES[
        columnId as keyof typeof COLUMN_TASK_STATUSES
      ];

      expect(statuses.length).toBeGreaterThan(0);
      for (const status of statuses) {
        expect(
          getTaskStatusMarker(status).tone.hue,
          `${status} sits in ${columnId}`,
        ).toBe(COLUMN_HUE_EXCEPTIONS[status] ?? COLUMN_HUE[columnId]);
      }
    },
  );

  /**
   * Without this the allowlist is free to outlive what it excuses: delete the
   * exception from the table and this test still passes, silently.
   */
  it("keeps the exception list to statuses that actually differ", () => {
    for (const [status, hue] of Object.entries(COLUMN_HUE_EXCEPTIONS)) {
      const columnId = Object.keys(COLUMN_TASK_STATUSES).find((id) =>
        COLUMN_TASK_STATUSES[id as keyof typeof COLUMN_TASK_STATUSES].includes(
          status as TaskStatus,
        ),
      );

      // `done` is not in COLUMN_HUE, so without this an exception listed for
      // COMPLETED, FAILED or CANCELED would compare against undefined and
      // pass unconditionally: the allowlist outliving what it excuses, which
      // is the one thing this test exists to stop.
      expect(columnId, `${status} is in no column`).toBeDefined();
      expect(
        COLUMN_HUE[columnId ?? ""],
        `${columnId} has no hue to differ from; only a single-hue column can` +
          ` carry an exception`,
      ).toBeDefined();

      expect(getTaskStatusMarker(status as TaskStatus).tone.hue).toBe(hue);
      expect(hue, `${status} no longer differs from its column`).not.toBe(
        COLUMN_HUE[columnId ?? ""],
      );
    }
  });

  /**
   * The bug this whole model exists to stop. Four statuses shared one hue
   * across three columns, so `READY`, `QUEUED` and `RUNNING` were the same
   * colour. Two columns may not resolve to one hue.
   */
  it("gives the four staged columns four different hues", () => {
    const hues = Object.values(COLUMN_HUE);

    expect(new Set(hues).size).toBe(hues.length);
  });

  /**
   * Rule 2. A column holding more than one status must separate them, and the
   * only channel left once hue is spent is weight. `input-required` is the
   * documented exception: it holds five, which no weight scale carries, so the
   * glyph separates them there and "glyph identity" below pins that.
   */
  it.each(["backlog", "todo", "in-progress"])(
    "separates the two statuses in %s by weight",
    (columnId) => {
      const statuses = COLUMN_TASK_STATUSES[
        columnId as keyof typeof COLUMN_TASK_STATUSES
      ];
      const weights = statuses.map(
        (status) => getTaskStatusMarker(status).tone.weight,
      );

      expect(statuses).toHaveLength(2);
      expect(new Set(weights).size).toBe(2);
    },
  );
});

describe("tone styles", () => {
  /**
   * The dot used to be derived from the marker by rewriting `text-` to `bg-`.
   * That works for every tone whose mark is the colour of a glyph, and breaks
   * for the one whose mark is the colour of a label on a solid fill: the old
   * `failure` produced `bg-semantic-destructive-foreground`, a near-white dot
   * measuring 1.06:1 on --card-background.
   */
  it.each(TONES_IN_USE.map((tone) => [toneName(tone), tone] as const))(
    "gives %s a dot that is not a label colour",
    (_name, tone) => {
      const { dot } = getToneStyle(tone);

      expect(dot).not.toMatch(/-foreground$/);
      expect(dot.startsWith("bg-")).toBe(true);
    },
  );

  it.each(TONES_IN_USE.map((tone) => [toneName(tone), tone] as const))(
    "gives %s an onSurface twin of its dot",
    (_name, tone) => {
      const { dot, onSurface } = getToneStyle(tone);

      expect(onSurface).toBe(dot.replace("bg-", "text-"));
      expect(onSurface).not.toMatch(/-foreground$/);
    },
  );

  /**
   * A colour token becomes a utility only through a `--color-*` bridge in
   * `@theme inline`. Without one the class emits no CSS at all, the badge
   * silently inherits, and every string-comparing test stays green.
   * `--status-external-tertiary` is new with this model and reads through
   * exactly that seam.
   */
  it.each(TONES_IN_USE.map((tone) => [toneName(tone), tone] as const))(
    "bridges every token %s paints with",
    (_name, tone) => {
      const style = getToneStyle(tone);
      const utilities = [
        ...utilitiesIn(style.box),
        style.label,
        style.mark,
        style.labelOnSurface,
        style.dot,
        style.onSurface,
      ];

      for (const token of utilities.map(tokenOf)) {
        // The formatter wraps the longer bridges across lines.
        const bridge = new RegExp(
          `--color-${token}:\\s*var\\(\\s*--${token},?\\s*\\)`,
        );

        expect(bridge.test(BRIDGES), `--color-${token} has no bridge`).toBe(
          true,
        );
        expect(() => declaredValue(THEMES.light, token)).not.toThrow();
        expect(() => declaredValue(THEMES.dark, token)).not.toThrow();
      }
    },
  );

  /**
   * Badge text is `text-xs`, so it is normal text and WCAG 2.2 SC 1.4.3 asks
   * 4.5:1; the dot is a non-text graphic and SC 1.4.11 asks 3:1. Measured
   * from the stylesheet, so retuning a hue and forgetting its label fails
   * here instead of shipping.
   *
   * A filled tone is measured on its own fill. An outline one paints no fill,
   * so it is measured on --card-background, the surface every current caller
   * puts it on.
   */
  it.each(TONES_IN_USE.map((tone) => [toneName(tone), tone] as const))(
    "keeps %s legible on the surface it is drawn on",
    (_name, tone) => {
      const style = getToneStyle(tone);
      const fill = utilitiesIn(style.box).find((entry) =>
        entry.startsWith("bg-"),
      );
      const ground = fill ? tokenOf(fill) : "card-background";

      for (const theme of [THEMES.light, THEMES.dark]) {
        expect(
          contrast(theme, ground, tokenOf(style.label)),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrast(theme, ground, tokenOf(style.mark)),
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  /**
   * `labelOnSurface` is what the activity feed and the share page paint, since
   * both dropped the badge box. It is read on --card-background by definition,
   * including for `solid`, whose own label is a near-white tuned for the solid
   * fill and would measure 1.06:1 here.
   */
  it.each(TONES_IN_USE.map((tone) => [toneName(tone), tone] as const))(
    "keeps the %s inline label legible on the card",
    (_name, tone) => {
      const { labelOnSurface } = getToneStyle(tone);

      for (const theme of [THEMES.light, THEMES.dark]) {
        expect(
          contrast(theme, "card-background", tokenOf(labelOnSurface)),
        ).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  /**
   * The bare dot is painted on a surface, not on a tone's fill, so the test
   * above cannot see it for filled tones. List rows use --muted on hover,
   * where the dark fault mark reaches only 2.53; that exception is recorded on
   * the model and is not measured here.
   */
  it.each(TONES_IN_USE.map((tone) => [toneName(tone), tone] as const))(
    "keeps the %s mark visible on the card surface",
    (_name, tone) => {
      for (const theme of [THEMES.light, THEMES.dark]) {
        expect(
          contrast(theme, "card-background", tokenOf(getToneStyle(tone).dot)),
        ).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("paints the solid fault dot with the solid fill, not its label", () => {
    expect(getToneStyle({ hue: "fault", weight: "solid" }).dot).toBe(
      "bg-semantic-destructive-solid",
    );
  });

  /**
   * `solid` is the escalation inside `fault` and nothing else. Spending it on
   * another hue would paint that hue's status destructive red, because the
   * solid branch ignores the hue entirely.
   */
  /**
   * `solid` belonging to `fault` alone used to be asserted here. `StatusTone`
   * is now a union that pairs them in the type, so inside this branch `tone`
   * narrows to `{ hue: "fault" }` and the assertion cannot fail. A test that
   * cannot fail is not a guard, so what remains is the part the type does not
   * carry: that something still paints `solid` at all, and that the scales
   * have not quietly dropped the escalation.
   */
  it("still paints the solid escalation somewhere", () => {
    expect(TONES_IN_USE.some((tone) => tone.weight === "solid")).toBe(true);
  });

  /**
   * A hue nothing paints is a hue nobody maintains, and the measurements above
   * only reach the tones the two scales actually use. If a hue is retired, the
   * type should lose it rather than sit here untested.
   */
  it("paints every hue the model declares", () => {
    const painted = new Set(TONES_IN_USE.map((tone) => tone.hue));

    for (const hue of HUES) {
      expect(painted.has(hue), `no status uses the ${hue} hue`).toBe(true);
    }
  });

  /** Same argument for weight: `solid` is rare, but it is not unused. */
  it("paints every weight the model declares", () => {
    const painted = new Set(TONES_IN_USE.map((tone) => tone.weight));

    for (const weight of WEIGHTS) {
      expect(painted.has(weight), `no status uses ${weight}`).toBe(true);
    }
  });
});

/**
 * Hue says which column and the glyph says which status, so two statuses that
 * share a hue must not share a glyph. Without this, collapsing several
 * statuses onto one icon would leave badges identical in both channels, which
 * is the failure WCAG 2.2 SC 1.4.1 is about.
 */
describe("glyph identity", () => {
  it("gives every task status in a hue its own glyph", () => {
    const seen = new Map<string, string>();
    for (const status of Object.values(TaskStatus)) {
      const { tone, icon } = getTaskStatusMarker(status);
      const key = `${tone.hue}:${icon.displayName ?? icon.name}`;
      expect(
        seen.has(key),
        `${status} shares ${key} with ${seen.get(key)}`,
      ).toBe(false);
      seen.set(key, status);
    }
  });

  /**
   * Jobs used to give PAYMENT_PENDING and STARTED one glyph as well as one
   * hue, on the reasoning that they are one stage seen twice. That left the
   * label as the only thing separating them, which is the same single-channel
   * failure this file exists to catch, so they now differ in both weight and
   * glyph and no job pair shares a hue and a glyph.
   */
  it("gives every job status in a hue its own glyph", () => {
    const seen = new Map<string, string>();
    for (const status of Object.values(SokosumiJobStatus)) {
      const { tone, icon } = getJobStatusMarker(status);
      const key = `${tone.hue}:${icon.displayName ?? icon.name}`;
      expect(
        seen.has(key),
        `${status} shares ${key} with ${seen.get(key)}`,
      ).toBe(false);
      seen.set(key, status);
    }
  });
});

describe("StatusMarker", () => {
  it("renders the tone's mark colour and hides the glyph from readers", () => {
    const spec = getTaskStatusMarker(TaskStatus.FAILED);
    const { container } = render(<StatusMarker spec={spec} />);
    const svg = container.querySelector("svg");

    expect(svg).toHaveClass("size-3.5", getToneStyle(spec.tone).mark);
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
    expect(draft.container.querySelector("svg")).not.toHaveClass(
      "animate-spin",
    );
  });

  /**
   * A stopped `LoaderCircle` is an arc with a gap in it and nothing else: the
   * glyph means motion, so frozen it reads as a rendering fault. That is a
   * reason to stop the spin on a surface that is not live, and it was once
   * taken as a reason to drop the glyph there and draw a dot instead.
   *
   * Dropping it broke the status picker, the only caller that passes
   * `live={false}`: five statuses share the `blocked` hue, so its marker
   * column became five identical dots. `live` now gates the spin and nothing
   * else, and a surface that wants a dot draws its own.
   */
  it.each([TaskStatus.RUNNING, TaskStatus.FAILED])(
    "keeps the %s glyph when it is not live, and stops the spin",
    (status) => {
      const spec = getTaskStatusMarker(status);
      const { container } = render(<StatusMarker spec={spec} live={false} />);
      const svg = container.querySelector("svg");

      expect(svg).not.toBeNull();
      expect(svg).not.toHaveClass("animate-spin");
    },
  );

  it("paints a non-live glyph with the caller's colour override", () => {
    const { container } = render(
      <StatusMarker
        spec={getTaskStatusMarker(TaskStatus.RUNNING)}
        tone="text-primary-foreground"
        live={false}
      />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "text-primary-foreground",
    );
  });
});
