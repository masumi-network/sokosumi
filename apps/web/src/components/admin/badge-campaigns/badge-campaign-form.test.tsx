import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/actions/admin-badge-campaigns/action", () => ({
  createAdminBadgeCampaignAction: createMock,
  updateAdminBadgeCampaignAction: vi.fn(),
}));

import { AnnouncedFeature } from "@sokosumi/core-client";
import {
  type AnnouncedFeatureLabels,
  BadgeCampaignForm,
} from "./badge-campaign-form";

const LABELS = Object.fromEntries(
  Object.values(AnnouncedFeature).map((feature) => [feature, feature]),
) as AnnouncedFeatureLabels;

describe("badge campaign dates in the admin's time zone", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the wall-clock time 21 days on, across a daylight-saving change", () => {
    render(<BadgeCampaignForm featureLabels={LABELS} />);
    fireEvent.change(screen.getByLabelText("Form.startsAt"), {
      target: { value: "2026-10-20T23:30" },
    });
    expect(screen.getByLabelText("Form.endsAt")).toHaveValue(
      "2026-11-10T23:30",
    );
  });
  it("preserves the admin's explicit end after another start selection", () => {
    render(<BadgeCampaignForm featureLabels={LABELS} />);
    fireEvent.change(screen.getByLabelText("Form.startsAt"), {
      target: { value: "2026-10-20T23:30" },
    });
    fireEvent.change(screen.getByLabelText("Form.endsAt"), {
      target: { value: "2026-11-15T12:00" },
    });
    fireEvent.change(screen.getByLabelText("Form.startsAt"), {
      target: { value: "2026-10-21T23:30" },
    });
    expect(screen.getByLabelText("Form.endsAt")).toHaveValue(
      "2026-11-15T12:00",
    );
  });

  it("fills the current minute and the default end with Start now", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 20, 59, 42));
    render(<BadgeCampaignForm featureLabels={LABELS} />);

    fireEvent.click(screen.getByRole("button", { name: "Form.startNow" }));

    expect(screen.getByLabelText("Form.startsAt")).toHaveValue(
      "2026-10-01T20:59",
    );
    expect(screen.getByLabelText("Form.endsAt")).toHaveValue(
      "2026-10-22T20:59",
    );
  });

  it("sends the local times to Core as the same moments in UTC", async () => {
    createMock.mockResolvedValue({ ok: true, value: {} });
    render(<BadgeCampaignForm featureLabels={LABELS} />);
    fireEvent.change(screen.getByLabelText("Form.startsAt"), {
      target: { value: "2026-10-01T20:57" },
    });

    // The feature select is Radix; pick through its hidden native select.
    fireEvent.change(document.querySelector("select") as HTMLSelectElement, {
      target: { value: "DRIVE" },
    });
    await act(async () => {
      fireEvent.submit(screen.getByRole("button", { name: "Form.create" }));
    });

    expect(createMock).toHaveBeenCalledWith({
      input: {
        feature: "DRIVE",
        startsAt: new Date(2026, 9, 1, 20, 57).toISOString(),
        endsAt: new Date(2026, 9, 22, 20, 57).toISOString(),
      },
    });
  });
});
