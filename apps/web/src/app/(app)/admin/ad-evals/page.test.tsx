import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CoreApiRequestError } from "@/lib/clients/core.request";

const mocks = vi.hoisted(() => ({
  hasAccess: vi.fn(),
  getDashboard: vi.fn(),
  dashboard: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/admin-ad-evals.service", () => ({
  adminAdEvalsService: {
    hasAccess: mocks.hasAccess,
    getDashboard: mocks.getDashboard,
  },
}));
vi.mock("@/components/admin/ad-evals/ad-evals-dashboard", () => ({
  AdEvalsDashboard: (props: Record<string, unknown>) => {
    mocks.dashboard(props);
    return <div data-testid="ad-evals-dashboard" />;
  },
}));

import AdminAdEvalsPage from "./page";

describe("AdminAdEvalsPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.hasAccess.mockResolvedValue(true);
  });

  it("renders the dashboard for an allowed admin", async () => {
    const dashboard = { counts: { ratings: 0 } };
    mocks.getDashboard.mockResolvedValue(dashboard);

    render(await AdminAdEvalsPage());

    expect(screen.getByTestId("ad-evals-dashboard")).toBeVisible();
    expect(mocks.dashboard).toHaveBeenCalledWith({ data: dashboard });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("renders not-found for a non-member without loading the dashboard", async () => {
    mocks.hasAccess.mockResolvedValue(false);

    await expect(AdminAdEvalsPage()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.getDashboard).not.toHaveBeenCalled();
  });

  it("renders not-found when Core refuses the dashboard after access was checked", async () => {
    mocks.getDashboard.mockRejectedValue(
      new CoreApiRequestError("Forbidden", { status: 403 }),
    );

    await expect(AdminAdEvalsPage()).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("preserves unexpected dashboard failures", async () => {
    mocks.getDashboard.mockRejectedValue(
      new CoreApiRequestError("Core unavailable", { status: 503 }),
    );

    await expect(AdminAdEvalsPage()).rejects.toThrow("Core unavailable");

    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("does not load the dashboard if the access check fails", async () => {
    mocks.hasAccess.mockRejectedValue(new Error("Core unavailable"));

    await expect(AdminAdEvalsPage()).rejects.toThrow("Core unavailable");

    expect(mocks.getDashboard).not.toHaveBeenCalled();
  });
});
