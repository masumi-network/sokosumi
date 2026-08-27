import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProvisioningState from "./provisioning-state";

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const t = (key: string, params?: Record<string, string | number>) => {
      if (key === "elapsedLabel" && params) return `${params.elapsed} elapsed`;
      return key;
    };
    t.raw = (key: string) => (key === "facts" ? { "0": "A fun fact." } : {});
    return t;
  },
}));

describe("ProvisioningState", () => {
  const NOW = new Date("2026-07-20T12:00:00.000Z").getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the true elapsed time immediately for a startedAt anchored in the past", () => {
    // Regression coverage: a tab close/reopen used to remount this
    // component and restart the clock at 0:00, even when provisioning had
    // genuinely been running for a while — startedAt must be honored on
    // first render, not just after the first 1s tick.
    render(<ProvisioningState seed={null} startedAt={NOW - 65_000} />);

    expect(screen.getByText("1:05 elapsed")).toBeInTheDocument();
  });

  it("ticks the elapsed time forward from the anchored startedAt", () => {
    render(<ProvisioningState seed={null} startedAt={NOW - 10_000} />);

    expect(screen.getByText("0:10 elapsed")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3_000);
    });

    expect(screen.getByText("0:13 elapsed")).toBeInTheDocument();
  });

  it("falls back to 0:00 when startedAt is null (e.g. preview mode)", () => {
    render(<ProvisioningState seed={null} startedAt={null} />);

    expect(screen.getByText("0:00 elapsed")).toBeInTheDocument();
  });
});
