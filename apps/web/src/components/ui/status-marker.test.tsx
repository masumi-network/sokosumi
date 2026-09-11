import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { getTaskStatusMarker } from "@/app/tasks/components/task-status-badge";
import {
  getJobStatusMarker,
  getJobStatusDotColorClass,
} from "@/components/jobs/job-status-styles";
import {
  STATUS_ROLE_STYLES,
  StatusMarker,
  type StatusRole,
} from "@/components/ui/status-marker";
import { SokosumiJobStatus, TaskStatus } from "@/lib/clients/generated/core";

const ROLES = Object.keys(STATUS_ROLE_STYLES) as StatusRole[];

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

  it("paints the failure dot with the solid fill, not its label", () => {
    expect(getJobStatusDotColorClass(SokosumiJobStatus.FAILED)).toBe(
      "bg-semantic-destructive-solid",
    );
  });
});

/**
 * Colour carries urgency and the glyph carries identity, so two statuses that
 * share a role must not share a glyph. Without this, collapsing several
 * statuses onto one icon would leave badges that are identical in both
 * channels, which is the failure WCAG 2.2 SC 1.4.1 is about.
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
