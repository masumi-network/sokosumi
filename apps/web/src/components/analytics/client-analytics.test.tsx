import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const speedInsightsProps = vi.fn();
const analyticsRendered = vi.fn();
const getEnvPublicConfigMock = vi.fn();

vi.mock("@/config/env.public", () => ({
  getEnvPublicConfig: () => getEnvPublicConfigMock(),
}));
vi.mock("@vercel/analytics/next", () => ({
  Analytics: () => {
    analyticsRendered();
    return null;
  },
}));
vi.mock("@vercel/speed-insights/next", () => ({
  SpeedInsights: (props: unknown) => {
    speedInsightsProps(props);
    return null;
  },
}));

import { ClientAnalytics } from "./client-analytics";

const event = {
  type: "vital" as const,
  url: "https://app.sokosumi.com/tasks/1",
};

async function renderBeforeSend() {
  render(<ClientAnalytics />);
  await waitFor(() => expect(speedInsightsProps).toHaveBeenCalled());
  return speedInsightsProps.mock.lastCall?.[0].beforeSend as (
    e: typeof event,
  ) => typeof event | null;
}

function stubVisibilityEntries(names: string[]) {
  vi.spyOn(performance, "getEntriesByType").mockImplementation((type) =>
    type === "visibility-state"
      ? names.map((name) => ({ name }) as PerformanceEntry)
      : [],
  );
}

describe("ClientAnalytics", () => {
  beforeEach(() => {
    getEnvPublicConfigMock.mockReturnValue({ NEXT_PUBLIC_NETWORK: "Mainnet" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    speedInsightsProps.mockReset();
    analyticsRendered.mockReset();
  });

  it("mounts Web Analytics on Mainnet", async () => {
    render(<ClientAnalytics />);
    await waitFor(() => expect(analyticsRendered).toHaveBeenCalled());
  });

  it("skips Web Analytics where the project has it off (Preprod)", async () => {
    getEnvPublicConfigMock.mockReturnValue({ NEXT_PUBLIC_NETWORK: "Preprod" });
    render(<ClientAnalytics />);
    await waitFor(() => expect(speedInsightsProps).toHaveBeenCalled());
    expect(analyticsRendered).not.toHaveBeenCalled();
  });

  it("drops vitals from a page load that started in a background tab", async () => {
    stubVisibilityEntries(["hidden", "visible"]);
    const beforeSend = await renderBeforeSend();

    expect(beforeSend(event)).toBeNull();
  });

  it("keeps vitals from a page load that started visible", async () => {
    stubVisibilityEntries(["visible", "hidden"]);
    const beforeSend = await renderBeforeSend();

    expect(beforeSend(event)).toEqual(event);
  });

  it("keeps vitals where the browser records no visibility entries", async () => {
    stubVisibilityEntries([]);
    const beforeSend = await renderBeforeSend();

    expect(beforeSend(event)).toEqual(event);
  });
});
