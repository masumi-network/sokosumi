import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { sendFeedbackMock } = vi.hoisted(() => ({
  sendFeedbackMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions/soko-bot/action", () => ({
  sendSokoBotTurnFeedbackAction: sendFeedbackMock,
}));

import {
  hasSokoBotMessageFooter,
  SokoBotFeedbackButtons,
  sokoBotSourceLabel,
} from "./soko-bot-message-footer";

const meta = (soko_bot: Record<string, unknown>) => ({
  soko_bot: { turn_id: "turn-1", ...soko_bot },
});

describe("sokoBotSourceLabel", () => {
  it("names where an unprompted message came from", () => {
    expect(sokoBotSourceLabel(meta({ source: "INGEST" }))).toEqual({
      kind: "inbox",
    });
    expect(sokoBotSourceLabel(meta({ source: "EVENT" }))).toEqual({
      kind: "taskUpdate",
    });
    expect(
      sokoBotSourceLabel(meta({ source: "SCHEDULE", schedule_key: "standup" })),
    ).toEqual({ kind: "standup" });
    expect(
      sokoBotSourceLabel(
        meta({ source: "SCHEDULE", schedule_key: "weekly-wrap" }),
      ),
    ).toEqual({ kind: "weeklyWrap" });
    expect(
      sokoBotSourceLabel(
        meta({ source: "SCHEDULE", schedule_name: "Monday check-in" }),
      ),
    ).toEqual({ kind: "scheduled", name: "Monday check-in" });
  });

  it("labels nothing on replies or non-bot messages", () => {
    expect(sokoBotSourceLabel(meta({ source: "CHAT" }))).toBeNull();
    expect(sokoBotSourceLabel(meta({}))).toBeNull();
    expect(sokoBotSourceLabel({})).toBeNull();
    expect(sokoBotSourceLabel(null)).toBeNull();
  });
});

describe("hasSokoBotMessageFooter", () => {
  it("leaves no empty footer when there is nothing to show", () => {
    expect(hasSokoBotMessageFooter(meta({}))).toBe(false);
    expect(hasSokoBotMessageFooter(meta({ task_ids: ["task-1"] }))).toBe(true);
    expect(
      hasSokoBotMessageFooter(meta({ pending_decision_ids: ["decision-1"] })),
    ).toBe(true);
  });
});

describe("SokoBotFeedbackButtons", () => {
  it("renders thumbs only for bot messages and locks after a rating", async () => {
    sendFeedbackMock.mockResolvedValue({ ok: true, value: null });
    const { rerender } = render(
      <SokoBotFeedbackButtons metadata={{}} buttonClassName="" />,
    );
    expect(screen.queryByRole("button")).toBeNull();

    rerender(<SokoBotFeedbackButtons metadata={meta({})} buttonClassName="" />);
    fireEvent.click(screen.getByRole("button", { name: "feedbackUseful" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "feedbackUseful" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
    expect(sendFeedbackMock).toHaveBeenCalledWith({
      turnId: "turn-1",
      useful: true,
    });
    expect(
      screen.getByRole("button", { name: "feedbackNotUseful" }),
    ).toBeDisabled();
  });
});
