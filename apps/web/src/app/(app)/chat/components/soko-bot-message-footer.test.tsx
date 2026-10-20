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

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" } } }),
}));

import {
  canRateSokoBotMessage,
  hasSokoBotMessageFooter,
  SokoBotFeedbackButtons,
  SokoBotMessageFooter,
  sharedSokoBotId,
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

  it("names a background run by its title", () => {
    expect(
      sokoBotSourceLabel(
        meta({ source: "CHAT", background_run_title: "Gmail CRM" }),
      ),
    ).toEqual({ kind: "background", name: "Gmail CRM" });
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

function botSender(
  scope: "personal" | "project" | "workspace",
  ownerUserId: string | null,
) {
  return {
    type: "sokoBot" as const,
    sokoBot: {
      id: "bot-1",
      name: "Ops",
      caption: null,
      image: null,
      avatarSeed: null,
      ownerUserId,
      scope,
      sharedRoomId: null,
      presence: "online" as const,
    },
  };
}

describe("canRateSokoBotMessage", () => {
  it("lets only the owner rate, because Core stores nothing else", () => {
    expect(
      canRateSokoBotMessage(botSender("personal", "user-1"), "user-1"),
    ).toBe(true);
    expect(
      canRateSokoBotMessage(botSender("personal", "user-2"), "user-1"),
    ).toBe(false);
    expect(canRateSokoBotMessage(botSender("workspace", null), "user-1")).toBe(
      false,
    );
    expect(
      canRateSokoBotMessage(botSender("personal", "user-1"), undefined),
    ).toBe(false);
    expect(canRateSokoBotMessage({ type: "unknown" }, "user-1")).toBe(false);
  });
});

describe("SokoBotFeedbackButtons", () => {
  it("shows no thumbs on a shared bot's message", () => {
    render(
      <SokoBotFeedbackButtons
        message={{ metadata: meta({}), sender: botSender("project", null) }}
        buttonClassName=""
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders thumbs only for bot messages and locks after a rating", async () => {
    sendFeedbackMock.mockResolvedValue({ ok: true, value: null });
    const sender = botSender("personal", "user-1");
    const { rerender } = render(
      <SokoBotFeedbackButtons
        message={{ metadata: {}, sender }}
        buttonClassName=""
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();

    rerender(
      <SokoBotFeedbackButtons
        message={{ metadata: meta({}), sender }}
        buttonClassName=""
      />,
    );
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

describe("SokoBotMessageFooter task previews", () => {
  it("omits only tasks already shown as cards and keeps approvals", () => {
    render(
      <SokoBotMessageFooter
        metadata={meta({
          task_ids: ["task-1", "task-2"],
          pending_decision_ids: ["decision-1"],
        })}
        previewedTaskIds={["task-1"]}
      />,
    );
    const links = screen.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toContain(
      "/tasks/task-2",
    );
    expect(links.map((link) => link.getAttribute("href"))).not.toContain(
      "/tasks/task-1",
    );
    expect(links).toHaveLength(2);
  });
  it("keeps the task link until its preview is available", () => {
    const { rerender } = render(
      <SokoBotMessageFooter metadata={meta({ task_ids: ["task-1"] })} />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/tasks/task-1");
    rerender(
      <SokoBotMessageFooter
        metadata={meta({ task_ids: ["task-1"] })}
        previewedTaskIds={["task-1"]}
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("approvals from a shared bot", () => {
  const pending = meta({ pending_decision_ids: ["d1"] });
  const bot = (scope: "personal" | "project" | "workspace") => ({
    type: "sokoBot" as const,
    sokoBot: {
      id: "bot-1",
      name: "Ops",
      caption: null,
      image: null,
      avatarSeed: null,
      ownerUserId: scope === "personal" ? "user-1" : null,
      scope,
      sharedRoomId: null,
      presence: "online" as const,
    },
  });

  it("names the sender only for a project or workspace bot", () => {
    expect(sharedSokoBotId(bot("workspace"))).toBe("bot-1");
    expect(sharedSokoBotId(bot("project"))).toBe("bot-1");
    expect(sharedSokoBotId(bot("personal"))).toBeNull();
    expect(sharedSokoBotId({ type: "unknown" })).toBeNull();
  });

  it("reads a sender without a scope, from an older Core, as personal", () => {
    const { scope: _scope, ...withoutScope } = bot("workspace").sokoBot;
    expect(
      sharedSokoBotId({
        type: "sokoBot",
        sokoBot: withoutScope as typeof withoutScope & {
          scope: "personal";
        },
      }),
    ).toBeNull();
  });

  it("links a shared bot's approvals to its own console", () => {
    render(<SokoBotMessageFooter metadata={pending} sharedBotId="bot-1" />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/soko-bots/bot-1?turn=turn-1",
    );
  });

  it("links the caller's own approvals to the assistant console", () => {
    render(<SokoBotMessageFooter metadata={pending} />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/personal-assistant?turn=turn-1",
    );
  });
});
