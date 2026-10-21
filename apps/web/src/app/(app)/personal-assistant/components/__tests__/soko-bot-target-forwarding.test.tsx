import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Every console panel acts on the bot its SokoBotTargetContext names. Each
 * test renders one panel inside a shared bot's context and checks that the
 * action (or request) it sends carries that bot's id.
 */
const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

const actions = vi.hoisted(() => {
  const ok = () => vi.fn(async () => ({ ok: true, value: {} }));
  return {
    archiveSokoBotAction: ok(),
    deleteSokoBotAction: ok(),
    resetSokoBotMemoryAction: ok(),
    setSokoBotFollowBoardAction: ok(),
    updateSokoBotProactiveAction: ok(),
    createSokoBotScheduleAction: ok(),
    updateSokoBotScheduleAction: ok(),
    deleteSokoBotScheduleAction: ok(),
    resolveSokoBotDecisionAction: ok(),
    connectSokoBotIntegrationAction: vi.fn(async () => ({
      ok: true,
      value: { redirectUrl: "https://composio.example/connect" },
    })),
    disconnectSokoBotIntegrationAction: ok(),
  };
});
const rememberMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/actions/soko-bot/action", () => actions);
vi.mock("@/lib/composio/oauth-popup-protocol", () => ({
  rememberComposioBotId: rememberMock,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign((key: string) => key, { has: () => false }),
  useFormatter: () => ({
    dateTime: () => "date",
    relativeTime: () => "soon",
    number: (value: number) => String(value),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ArchiveSokoBotButton } from "../archive-soko-bot-button.client";
import { DecisionCard } from "../chat/decision-card";
import { TurnExplain } from "../chat/turn-explain";
import { DeleteSokoBotButton } from "../delete-soko-bot-button.client";
import { FollowBoardToggle } from "../follow-board-toggle.client";
import { ProactiveSettings } from "../proactive-settings.client";
import { ResetMemoryButton } from "../reset-memory-button.client";
import { ScheduleForm } from "../schedule-form.client";
import { ScheduleRowActions } from "../schedule-row-actions.client";
import { SokoBotTargetContext } from "../soko-bot-target";
import { useIntegrationActions } from "../use-integration-actions";

function SharedBot({ children }: { children: ReactNode }) {
  return (
    <SokoBotTargetContext.Provider value={BOT_ID}>
      {children}
    </SokoBotTargetContext.Provider>
  );
}

function renderShared(ui: ReactNode): void {
  render(<SharedBot>{ui}</SharedBot>);
}

const withBot = expect.objectContaining({ botId: BOT_ID });

describe("console panels act on the shared bot in context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("archive", async () => {
    renderShared(<ArchiveSokoBotButton />);
    fireEvent.click(screen.getByRole("button", { name: "archive" }));
    expect(
      await screen.findByText("sharedArchiveConfirmTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("sharedArchiveConfirmDescription"),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "archiveConfirm" }),
    );
    await waitFor(() =>
      expect(actions.archiveSokoBotAction).toHaveBeenCalledWith(withBot),
    );
  });

  it("delete", async () => {
    renderShared(<DeleteSokoBotButton botName={null} />);
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    expect(
      await screen.findByText("sharedDeleteConfirmTitle"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("sharedDeleteConfirmDescription"),
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole("button", { name: "deleteConfirm" }),
    );
    await waitFor(() =>
      expect(actions.deleteSokoBotAction).toHaveBeenCalledWith(withBot),
    );
  });

  it("memory reset", async () => {
    renderShared(<ResetMemoryButton />);
    fireEvent.click(screen.getByRole("button", { name: "reset" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "resetConfirm" }),
    );
    await waitFor(() =>
      expect(actions.resetSokoBotMemoryAction).toHaveBeenCalledWith(withBot),
    );
  });

  it("follow board", async () => {
    renderShared(<FollowBoardToggle initial={false} />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(actions.setSokoBotFollowBoardAction).toHaveBeenCalledWith(withBot),
    );
  });

  it("proactive settings", async () => {
    renderShared(
      <ProactiveSettings
        initial={{ paused: false, dailyLimit: 5, timezone: "UTC" }}
        usedToday={null}
        paidByOrganization
      />,
    );
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(actions.updateSokoBotProactiveAction).toHaveBeenCalledWith(
        withBot,
      ),
    );
  });

  it("schedule form", async () => {
    renderShared(<ScheduleForm />);
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    const form = document.querySelector("form");
    if (!form) throw new Error("schedule form did not open");
    fireEvent.submit(form);
    await waitFor(() =>
      expect(actions.createSokoBotScheduleAction).toHaveBeenCalledWith(withBot),
    );
  });

  it("schedule toggle and delete", async () => {
    renderShared(<ScheduleRowActions scheduleId="s1" enabled />);
    fireEvent.click(screen.getByRole("switch"));
    await waitFor(() =>
      expect(actions.updateSokoBotScheduleAction).toHaveBeenCalledWith(withBot),
    );
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "deleteConfirm" }),
    );
    await waitFor(() =>
      expect(actions.deleteSokoBotScheduleAction).toHaveBeenCalledWith(withBot),
    );
  });

  it("decision card", async () => {
    renderShared(
      <DecisionCard
        decision={{
          id: "d1",
          turnId: "t1",
          toolName: "hire_agent",
          proposal: {},
          reason: "because",
          status: "PENDING",
          expiresAt: "2026-10-20T00:00:00.000Z",
          resolvedAt: null,
          resultingEntityId: null,
          createdAt: "2026-10-14T00:00:00.000Z",
        }}
        onResolved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reject/ }));
    await waitFor(() =>
      expect(actions.resolveSokoBotDecisionAction).toHaveBeenCalledWith(
        withBot,
      ),
    );
  });

  it("turn explanation", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    renderShared(<TurnExplain turnId="t1" stepCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /toggle/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/personal-assistant/turns/t1?botId=${BOT_ID}`,
        expect.anything(),
      ),
    );
  });

  it("integration connect and disconnect", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { origin: "https://app.test", assign });
    const { result } = renderHook(() => useIntegrationActions(), {
      wrapper: SharedBot,
    });
    result.current.connect("gmail");
    await waitFor(() => expect(assign).toHaveBeenCalled());
    expect(actions.connectSokoBotIntegrationAction).toHaveBeenCalledWith(
      expect.objectContaining({
        botId: BOT_ID,
        returnUrl: expect.stringContaining(`botId=${BOT_ID}`),
      }),
    );
    expect(rememberMock).toHaveBeenCalledWith(BOT_ID);
    result.current.disconnect("gmail");
    await waitFor(() =>
      expect(actions.disconnectSokoBotIntegrationAction).toHaveBeenCalledWith(
        withBot,
      ),
    );
  });

  it("keeps the personal archive and delete copy on the caller's own bot", async () => {
    render(<ArchiveSokoBotButton />);
    fireEvent.click(screen.getByRole("button", { name: "archive" }));
    expect(await screen.findByText("archiveConfirmTitle")).toBeInTheDocument();
    expect(screen.getByText("archiveConfirmDescription")).toBeInTheDocument();
  });

  it("keeps the personal delete copy on the caller's own bot", async () => {
    render(<DeleteSokoBotButton botName={null} />);
    fireEvent.click(screen.getByRole("button", { name: "delete" }));
    expect(await screen.findByText("deleteConfirmTitle")).toBeInTheDocument();
    expect(screen.getByText("deleteConfirmDescription")).toBeInTheDocument();
  });
});
