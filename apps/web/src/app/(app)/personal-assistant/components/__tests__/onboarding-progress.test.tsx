import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import OnboardingProgress from "../onboarding-progress";

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
      return key;
    };
    t.raw = (_key: string) => ({});
    return t;
  },
}));

vi.mock("@/components/aurora-orb", () => ({
  AssistantOrb: () => <div data-testid="orb" />,
}));
vi.mock("../flow-background", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock("../progress-pips", () => ({
  default: () => <div data-testid="pips" />,
}));
vi.mock("../rotating-messages", () => ({
  default: () => <div data-testid="hints" />,
}));

function progressResult(status: string) {
  return {
    ok: true,
    data: { status, steps: [], etaSeconds: null },
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
