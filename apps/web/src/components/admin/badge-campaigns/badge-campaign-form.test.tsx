import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { count?: number }) =>
    values?.count === undefined ? key : `${key}:${values.count}`,
  useFormatter: () => ({ dateTime: (date: Date) => date.toISOString() }),
}));
vi.mock("@/lib/actions/admin-badge-campaigns/action", () => ({
  createAdminBadgeCampaignAction: createMock,
  updateAdminBadgeCampaignAction: vi.fn(),
}));

import { AnnouncedFeature, type BadgeCampaign } from "@sokosumi/core-client";
import {
  type AnnouncedFeatureLabels,
  BadgeCampaignForm,
} from "./badge-campaign-form";

const LABELS = Object.fromEntries(
  Object.values(AnnouncedFeature).map((feature) => [feature, feature]),
) as AnnouncedFeatureLabels;

function setStart(value: string) {
  fireEvent.change(screen.getByLabelText("Form.startsAt"), {
    target: { value },
  });
}

async function submitForDrive() {
  // The feature select is Radix; pick through its hidden native select.
  fireEvent.change(document.querySelector("select") as HTMLSelectElement, {
    target: { value: "DRIVE" },
  });
  await act(async () => {
    fireEvent.submit(screen.getByRole("button", { name: "Form.create" }));
  });
}

/** Local wall-clock times, as the admin typed them, in UTC for Core. */
function utc(...parts: [number, number, number, number, number]) {
  return new Date(...parts).toISOString();
}

describe("badge campaign form", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ ok: true, value: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs 3 weeks by default, keeping the wall-clock time across a DST change", async () => {
    render(<BadgeCampaignForm featureLabels={LABELS} />);
    expect(screen.getByRole("radio", { name: "Form.weeks:3" })).toBeChecked();

    setStart("2026-10-20T23:30");
    await submitForDrive();

    expect(createMock).toHaveBeenCalledWith({
      input: {
        feature: "DRIVE",
        startsAt: utc(2026, 9, 20, 23, 30),
        endsAt: utc(2026, 10, 10, 23, 30),
      },
    });
  });

  it("ends a week after the start when 1 week is picked", async () => {
    render(<BadgeCampaignForm featureLabels={LABELS} />);
    setStart("2026-10-01T20:57");
    fireEvent.click(screen.getByRole("radio", { name: "Form.weeks:1" }));
    await submitForDrive();

    expect(createMock).toHaveBeenCalledWith({
      input: {
        feature: "DRIVE",
        startsAt: utc(2026, 9, 1, 20, 57),
        endsAt: utc(2026, 9, 8, 20, 57),
      },
    });
  });

  it("asks for an end only when Custom is picked, starting from the shown one", async () => {
    render(<BadgeCampaignForm featureLabels={LABELS} />);
    setStart("2026-10-01T20:57");
    expect(screen.queryByLabelText("Form.endsAt")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Form.custom" }));
    expect(screen.getByLabelText("Form.endsAt")).toHaveValue(
      "2026-10-22T20:57",
    );
    fireEvent.change(screen.getByLabelText("Form.endsAt"), {
      target: { value: "2026-11-15T12:00" },
    });
    await submitForDrive();

    expect(createMock).toHaveBeenCalledWith({
      input: {
        feature: "DRIVE",
        startsAt: utc(2026, 9, 1, 20, 57),
        endsAt: utc(2026, 10, 15, 12, 0),
      },
    });
  });

  it("fills the current minute with Start now", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 1, 20, 59, 42));
    render(<BadgeCampaignForm featureLabels={LABELS} />);

    fireEvent.click(screen.getByRole("button", { name: "Form.startNow" }));

    expect(screen.getByLabelText("Form.startsAt")).toHaveValue(
      "2026-10-01T20:59",
    );
  });

  it("opens an existing campaign on the length it was saved with", () => {
    const campaign: BadgeCampaign = {
      id: "campaign-1",
      feature: "DRIVE",
      startsAt: new Date(2026, 9, 1, 9, 0),
      endsAt: new Date(2026, 9, 15, 9, 0),
      createdAt: new Date(2026, 9, 1),
    };
    render(<BadgeCampaignForm featureLabels={LABELS} campaign={campaign} />);

    expect(screen.getByRole("radio", { name: "Form.weeks:2" })).toBeChecked();
  });
});
