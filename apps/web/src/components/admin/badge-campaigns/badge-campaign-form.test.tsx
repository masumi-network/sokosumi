import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/lib/actions/admin-badge-campaigns/action", () => ({
  createAdminBadgeCampaignAction: vi.fn(),
  updateAdminBadgeCampaignAction: vi.fn(),
}));

import { BadgeCampaignForm } from "./badge-campaign-form";

describe("badge campaign UTC dates", () => {
  it("defaults to 21 UTC days across a daylight-saving boundary", () => {
    render(<BadgeCampaignForm />);
    fireEvent.change(screen.getByLabelText("Form.startsAt"), {
      target: { value: "2026-10-20T23:30" },
    });
    expect(screen.getByLabelText("Form.endsAt")).toHaveValue(
      "2026-11-10T23:30",
    );
  });
  it("preserves the admin's explicit end after another start selection", () => {
    render(<BadgeCampaignForm />);
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
});
