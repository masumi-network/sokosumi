import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingProgress from "./onboarding-progress";

const { getProgressMock } = vi.hoisted(() => ({
  getProgressMock: vi.fn(),
}));

vi.mock("@/lib/actions/hermes", () => ({
  getHermesOnboardingProgressAction: (...args: unknown[]) =>
    getProgressMock(...args),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, string | number>) => {
      if (key === "elapsedLabel" && params) return `${params.elapsed} elapsed`;
      if (key === "etaMinutesLabel" && params)
        return `about ${params.minutes} min remaining`;
      return key;
    };
    t.raw = (_key: string) => ({});
    return t;
  },
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: () => <div data-testid="orb" />,
}));
vi.mock("./flow-background", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("./progress-pips", () => ({
  default: () => <div data-testid="pips" />,
}));
vi.mock("./rotating-messages", () => ({
  default: () => <div data-testid="hints" />,
}));

function progressResult(status: string) {
  return {
    ok: true,
    value: { status, steps: [], etaSeconds: null },
  };
}

describe("OnboardingProgress", () => {
  const NOW = new Date("2026-07-20T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(NOW);
    getProgressMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the persisted elapsed time, matching the provisioning screen", () => {
    getProgressMock.mockResolvedValue(progressResult("onboarding"));

    render(
      <OnboardingProgress
        previewMode={false}
        seed={null}
        startedAt={NOW - 65_000}
      />,
    );

    expect(screen.getByText("1:05 elapsed")).toBeInTheDocument();
  });

  it("keeps nudging onTerminalStatus once the polled status settles", async () => {
    // Regression coverage: the parent's instance-polling loop is a
    // self-rescheduling timeout chain — a single hung request kills it and
    // the user used to sit on a fully-checkmarked onboarding screen until a
    // manual reload. This screen's own interval poll must hand the
    // transition to the parent, and keep retrying in case one recovery
    // refetch fails.
    getProgressMock.mockResolvedValue(progressResult("ready"));
    const onTerminalStatus = vi.fn();

    render(
      <OnboardingProgress
        previewMode={false}
        seed={null}
        startedAt={NOW}
        onTerminalStatus={onTerminalStatus}
      />,
    );

    // First poll fires immediately on mount; wait for its promise to settle.
    await waitFor(() => expect(onTerminalStatus).toHaveBeenCalled());

    // The nudge repeats every 2s while the screen stays mounted. Interval
    // callbacks fire synchronously under advanceTimersByTime.
    act(() => {
      vi.advanceTimersByTime(4_100);
    });
    expect(onTerminalStatus.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("shows one neutral warming-up line instead of a fabricated step list before steps arrive", async () => {
    // Boot-window shape: no steps yet, and the orchestrator computes
    // etaSeconds as remaining × 25 — which is 0 with zero steps. That 0
    // must not surface as "Almost done…" during a 1–2 min machine boot.
    getProgressMock.mockResolvedValue({
      ok: true,
      value: { status: "onboarding", steps: [], etaSeconds: 0 },
    });

    render(
      <OnboardingProgress previewMode={false} seed={null} startedAt={NOW} />,
    );

    await waitFor(() => expect(getProgressMock).toHaveBeenCalled());
    expect(screen.getByText("stepFallbackLabel")).toBeInTheDocument();
    expect(screen.queryByText("etaSettling")).not.toBeInTheDocument();
    // The old 6-step skeleton fabricated rows with local ids — none of that
    // may render anymore; the orchestrator's payload is the only source.
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
    expect(screen.queryByText("save_details")).not.toBeInTheDocument();
  });

  it("renders the polled steps verbatim — dynamic subset, orchestrator labels, coarse ETA", async () => {
    getProgressMock.mockResolvedValue({
      ok: true,
      value: {
        status: "onboarding",
        // A realistic dynamic subset: no integration/sokosumi steps, the
        // inbox step skipped with its alternate label, orchestrator ids
        // ("memory") that never matched the old local skeleton ids.
        steps: [
          { id: "memory", label: "Saving your details", status: "running" },
          { id: "inbox_scan", label: "Inbox not connected", status: "skipped" },
          {
            id: "intro_draft",
            label: "Drafting your intro",
            status: "pending",
          },
        ],
        etaSeconds: 95,
      },
    });

    render(
      <OnboardingProgress previewMode={false} seed={null} startedAt={NOW} />,
    );

    await waitFor(() =>
      expect(screen.getByText("Saving your details")).toBeInTheDocument(),
    );
    const skippedLabel = screen.getByText("Inbox not connected");
    expect(skippedLabel).toBeInTheDocument();
    // Skipped labels are status explanations ("Inbox not connected"); a
    // line-through would visually negate them. Assert the class contract so
    // re-adding line-through fails the suite.
    expect(skippedLabel).not.toHaveClass("line-through");
    expect(screen.getByText("Drafting your intro")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    // 95s rounds up to a 2-minute coarse ETA.
    expect(screen.getByText("about 2 min remaining")).toBeInTheDocument();
    expect(screen.queryByText("stepFallbackLabel")).not.toBeInTheDocument();
  });

  it("keeps the last non-empty step list when a later poll returns no steps", async () => {
    // The contract doesn't guarantee steps on every poll (Core maps an
    // absent array to []) — a step-less 200 mid-run must not bounce the
    // rendered checklist back to the warming-up line.
    getProgressMock
      .mockResolvedValueOnce({
        ok: true,
        value: {
          status: "onboarding",
          steps: [
            { id: "memory", label: "Saving your details", status: "running" },
          ],
          etaSeconds: 90,
        },
      })
      // Later step-less polls also carry the fabricated etaSeconds: 0 —
      // both the rows AND the last real ETA must survive them.
      .mockResolvedValue({
        ok: true,
        value: { status: "onboarding", steps: [], etaSeconds: 0 },
      });

    render(
      <OnboardingProgress previewMode={false} seed={null} startedAt={NOW} />,
    );

    await waitFor(() =>
      expect(screen.getByText("Saving your details")).toBeInTheDocument(),
    );

    // Let several step-less polls land; the rows must survive them.
    act(() => {
      vi.advanceTimersByTime(2_100);
    });
    await waitFor(() =>
      expect(getProgressMock.mock.calls.length).toBeGreaterThanOrEqual(3),
    );
    expect(screen.getByText("Saving your details")).toBeInTheDocument();
    expect(screen.queryByText("stepFallbackLabel")).not.toBeInTheDocument();
    // The retained 90s ETA still shows; the step-less polls' 0 never
    // downgraded it to the settling copy.
    expect(screen.getByText("about 2 min remaining")).toBeInTheDocument();
    expect(screen.queryByText("etaSettling")).not.toBeInTheDocument();
  });

  it("hands the ETA off to the settling copy when etaSeconds is ≤ 30s", async () => {
    getProgressMock.mockResolvedValue({
      ok: true,
      value: {
        status: "onboarding",
        steps: [
          {
            id: "intro_draft",
            label: "Drafting your intro",
            status: "running",
          },
        ],
        etaSeconds: 20,
      },
    });

    render(
      <OnboardingProgress previewMode={false} seed={null} startedAt={NOW} />,
    );

    await waitFor(() =>
      expect(screen.getByText("etaSettling")).toBeInTheDocument(),
    );
  });

  it("does not nudge while onboarding is still in flight", async () => {
    getProgressMock.mockResolvedValue(progressResult("onboarding"));
    const onTerminalStatus = vi.fn();

    render(
      <OnboardingProgress
        previewMode={false}
        seed={null}
        startedAt={NOW}
        onTerminalStatus={onTerminalStatus}
      />,
    );

    // Let the initial poll settle, then push well past several poll and
    // would-be nudge windows.
    await waitFor(() => expect(getProgressMock).toHaveBeenCalled());
    act(() => {
      vi.advanceTimersByTime(3_100);
    });
    expect(onTerminalStatus).not.toHaveBeenCalled();
  });
});
