import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { SokosumiJobStatus } from "@/lib/clients/generated/core";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

describe("JobStatusBadge", () => {
  it("renders a pill badge with label by default", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.COMPLETED} />,
    );

    expect(screen.getByText("completed")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("rounded-sm", "px-2.5", "py-1");
  });

  /**
   * Several job statuses now share one role, so the compact mark can no longer
   * lean on hue. RESULT_PENDING and DISPUTE_PENDING are the pair used here:
   * both are `problem`, and both were `problem` before this commit, so the
   * test pins the two channels that separate same-role statuses in general.
   * Those channels are the glyph, and the accessible name a screen reader
   * gets.
   */
  it("separates two same-role statuses by glyph and by name", () => {
    // Both are `problem` and neither spins, so the only thing that can carry
    // the difference is the icon itself. A pair where one spins would be
    // separable in the UI by the animation, which would not show that the
    // glyph alone does the work.
    const missing = render(
      <JobStatusBadge
        status={SokosumiJobStatus.RESULT_PENDING}
        variant="dot"
      />,
    );
    const dispute = render(
      <JobStatusBadge
        status={SokosumiJobStatus.DISPUTE_PENDING}
        variant="dot"
      />,
    );

    const iconOf = (r: ReturnType<typeof render>) =>
      [...(r.container.querySelector("svg")?.classList ?? [])].find((name) =>
        name.startsWith("lucide-"),
      );

    expect(iconOf(missing)).toBeDefined();
    expect(iconOf(missing)).not.toBe(iconOf(dispute));
    expect(
      missing.container
        .querySelector("[role='img']")
        ?.getAttribute("aria-label"),
    ).not.toBe(
      dispute.container
        .querySelector("[role='img']")
        ?.getAttribute("aria-label"),
    );
  });

  /**
   * The compact mark is painted on whatever surface the row uses, so a caller
   * must be able to override the role colour. This pins that the caller's
   * colour wins and the role colour does not survive. It does not pin HOW:
   * `cn` is tailwind-merge, so an implementation that appended the caller's
   * class would merge to the same single class and pass here too.
   */
  it("lets the caller replace the glyph colour", () => {
    const { container } = render(
      <JobStatusBadge
        status={SokosumiJobStatus.COMPLETED}
        variant="dot"
        tone="text-primary-foreground"
      />,
    );

    const glyph = container.querySelector("svg");
    expect(glyph).toHaveClass("text-primary-foreground");
    expect(glyph).not.toHaveClass("text-semantic-success");
  });

  it("renders dot-only version when variant is dot", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.COMPLETED} variant="dot" />,
    );

    expect(screen.queryByText("completed")).not.toBeInTheDocument();
    // By role and name, not by attribute: the point is that a screen reader
    // gets the status, and `aria-label` on a generic element would not give
    // it one.
    expect(screen.getByRole("img", { name: "completed" })).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("shrink-0");
  });

  /**
   * The compact variant has no fill behind it, so the glyph cannot wear
   * `marker`, which is the colour of the label ON the fill. For the failure
   * role that label is near-white and measured 1.06:1 on --card-background.
   * COMPLETED cannot catch this, because its marker and its surface colour
   * are the same token; only a solid-fill role can.
   */
  it("colours the compact failure mark against the surface, not the fill", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.FAILED} variant="dot" />,
    );

    const glyph = container.querySelector("svg");
    expect(glyph).toHaveClass("text-semantic-destructive-solid");
    expect(glyph).not.toHaveClass("text-semantic-destructive-foreground");
  });

  it("applies the attention ramp to the input-required icon", () => {
    const { container } = render(
      <JobStatusBadge status={SokosumiJobStatus.INPUT_REQUIRED} />,
    );

    expect(container.querySelector("svg")).toHaveClass(
      "size-3.5",
      "text-semantic-warning",
    );
  });
});
