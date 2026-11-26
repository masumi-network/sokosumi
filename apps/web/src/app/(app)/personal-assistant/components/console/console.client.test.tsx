import {
  createEmptySokoBotMemory,
  renderSokoBotMemory,
} from "@sokosumi/soko-bot";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useContext } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

import { SokoBotTargetContext } from "../soko-bot-target";
import { SokoBotConsole, type SokoBotConsoleProps } from "./console.client";

const pushMock = vi.fn();
const refreshMock = vi.fn();
const toastErrorMock = vi.fn();
const ensureRoomMock = vi.fn();
const useStateMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    prefetch: vi.fn(),
    replace: vi.fn(),
    refresh: refreshMock,
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(",")})` : key,
  useFormatter: () => ({
    // A time on another clock reads as that clock's name, so a test can tell
    // the schedule's clock from the viewer's.
    dateTime: (
      _date: Date,
      _format?: string,
      options?: { timeZone?: string },
    ) => options?.timeZone ?? "date",
    relativeTime: () => "now",
  }),
  useNow: () => new Date("2026-10-29T12:00:00Z"),
}));
const viewMock = vi.fn(() => "advanced" as string | null);
const scheduleParamMock = vi.fn(() => null as string | null);
vi.mock("nuqs", () => ({
  useQueryState: (key: string) => [
    key === "schedule" ? scheduleParamMock() : viewMock(),
    vi.fn(),
  ],
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastErrorMock(...a) },
}));
vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: (...a: unknown[]) => ensureRoomMock(...a),
}));
vi.mock("../chat/use-soko-bot-state", () => ({
  useSokoBotState: (...a: unknown[]) => useStateMock(...a),
}));
vi.mock("../chat/assistant-avatar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat/assistant-avatar")>()),
  AssistantAvatar: () => <span />,
}));

function TargetProbe({ name }: { name: string }) {
  const target = useContext(SokoBotTargetContext);
  return <span data-testid={name}>{target ?? "own"}</span>;
}

vi.mock("../archive-soko-bot-button.client", () => ({
  ArchiveSokoBotButton: () => <TargetProbe name="archive" />,
}));
vi.mock("../delete-soko-bot-button.client", () => ({
  DeleteSokoBotButton: () => <span data-testid="delete" />,
}));
vi.mock("../reset-memory-button.client", () => ({
  ResetMemoryButton: () => <span data-testid="reset" />,
}));
vi.mock("../skills-section.client", () => ({
  SkillsSection: () => <span data-testid="skills" />,
}));
vi.mock("../avatar-studio.client", () => ({
  // The studio itself is tested on its own; here it stands for "the dialog is open".
  AvatarStudioDialog: ({
    initialCode,
    onSaved,
    onOpenChange,
  }: {
    initialCode: string | null;
    onSaved: () => void;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div role="dialog" data-testid="avatar" data-code={initialCode}>
      <button
        type="button"
        onClick={async () => {
          await onSaved();
          onOpenChange(false);
        }}
      >
        save look
      </button>
    </div>
  ),
}));
vi.mock("../schedule-form.client", () => ({
  ScheduleForm: () => <TargetProbe name="schedule" />,
}));
// The row's actions leave with a removed row, so the test keeps their report.
const rowActions = vi.hoisted(() => ({
  reportRemoved: (_removed: boolean) => {},
}));
vi.mock("../schedule-row-actions.client", () => ({
  ScheduleRowActions: ({
    onRemovedChange,
  }: {
    onRemovedChange: (removed: boolean) => void;
  }) => {
    rowActions.reportRemoved = onRemovedChange;
    return null;
  },
}));
vi.mock("../proactive-settings.client", () => ({
  ProactiveSettings: () => <span data-testid="proactive" />,
}));
vi.mock("../follow-board-toggle.client", () => ({
  FollowBoardToggle: () => <span data-testid="follow-board" />,
}));
vi.mock("../mail-auto-read-toggle.client", () => ({
  MailAutoReadToggle: () => <span data-testid="mail-auto-read" />,
}));
vi.mock("../integrations-section.client", () => ({
  IntegrationsSection: () => <span data-testid="integrations" />,
}));
vi.mock("./tool-connectors.client", () => ({
  ToolConnectors: ({ readOnly }: { readOnly?: boolean }) => (
    <span data-testid="connectors" data-read-only={String(Boolean(readOnly))} />
  ),
}));
vi.mock("../ad-accounts-section", () => ({
  AdAccountsSection: ({ botProjectId }: { botProjectId: string | null }) => (
    <span data-testid="ads">{botProjectId ?? "all"}</span>
  ),
}));
vi.mock("./daily-stats", () => ({
  DailyStats: () => <span data-testid="daily-stats" />,
}));
vi.mock("./usage-summary", () => ({
  UsageSummary: () => <span data-testid="usage-summary" />,
}));
vi.mock("../how-it-works", () => ({ HowItWorks: () => null }));
vi.mock("./activity-list.client", () => ({ ActivityList: () => null }));

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";

function chatState(viewerCanManage: boolean): SokoBotChatState {
  return {
    bot: {
      id: BOT_ID,
      userId: null,
      viewerCanManage,
      name: "Ops",
      avatarSeed: null,
      avatarImageUrl: null,
      versionId: null,
      followWholeBoard: false,
      joinsTeamStandup: false,
      mailAutoRead: false,
      ingestTimezone: "Europe/Berlin",
      proactivePaused: false,
      proactiveDailyLimit: 20,
      status: "IDLE",
      memoryVersion: 0,
      memory: null,
      lastActivityAt: null,
      schedules: [],
      pendingDecisions: [],
    },
    turns: [],
  };
}

function consoleElement(overrides: Partial<SokoBotConsoleProps>) {
  const initialState = overrides.initialState ?? chatState(true);
  useStateMock.mockReturnValue({ state: initialState, refresh: vi.fn() });
  return (
    <SokoBotConsole
      initialState={initialState}
      userName={null}
      userImageUrl={null}
      focusTurnId={null}
      version={null}
      installedSkills={[]}
      stats={null}
      usage={null}
      integrations={null}
      adminHref={null}
      connectProvider={null}
      integrationOutcome={null}
      paidByOrganization
      botId={BOT_ID}
      canManage
      sharedRoomId="room-1"
      ads={null}
      {...overrides}
    />
  );
}

function renderConsole(overrides: Partial<SokoBotConsoleProps>) {
  return render(consoleElement(overrides));
}

describe("SokoBotConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewMock.mockReturnValue("advanced");
    scheduleParamMock.mockReturnValue(null);
  });

  it("offers archive, delete and memory reset to a manager of a shared bot", () => {
    renderConsole({ canManage: true });
    expect(screen.getByTestId("archive")).toHaveTextContent(BOT_ID);
    expect(screen.getByTestId("delete")).toBeInTheDocument();
    expect(screen.getByTestId("reset")).toBeInTheDocument();
    expect(
      screen.getByText("Settings.sharedArchiveDescription"),
    ).toBeInTheDocument();
  });

  it("hides archive, delete and memory reset from a member who cannot manage", () => {
    renderConsole({ canManage: false });
    expect(screen.queryByTestId("archive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete")).not.toBeInTheDocument();
    expect(screen.queryByTestId("reset")).not.toBeInTheDocument();
  });

  it("locks Cuso's settings, memory and archive, with the CMO banner", () => {
    renderConsole({ canManage: true, cmoProjectId: "project-9" });
    expect(screen.getByTestId("cmo-project-banner")).toBeInTheDocument();
    for (const id of ["archive", "delete", "reset", "proactive"]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(screen.queryByTestId("follow-board")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mail-auto-read")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Rename/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps those controls on any other shared bot", () => {
    renderConsole({ canManage: true, cmoProjectId: null });
    expect(screen.queryByTestId("cmo-project-banner")).not.toBeInTheDocument();
    for (const id of ["archive", "delete", "reset", "proactive"]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it("leaves Cuso's schedules readable but offers no new one", () => {
    viewMock.mockReturnValue(null);
    renderConsole({ cmoProjectId: "project-9" });
    expect(screen.getByText("Schedules.title")).toBeInTheDocument();
    expect(screen.queryByTestId("schedule")).not.toBeInTheDocument();
    // Chat with Cuso stays open.
    expect(
      screen.getByRole("button", { name: /Console.openChat/ }),
    ).toBeInTheDocument();
  });

  it("offers Cuso's apps read-only and any other bot's to connect", () => {
    viewMock.mockReturnValue(null);
    const integrations = { configured: true, integrations: [] };
    const { unmount } = renderConsole({
      integrations,
      cmoProjectId: "project-9",
    });
    expect(screen.getByTestId("connectors")).toHaveAttribute(
      "data-read-only",
      "true",
    );
    unmount();
    renderConsole({ integrations, cmoProjectId: null });
    expect(screen.getByTestId("connectors")).toHaveAttribute(
      "data-read-only",
      "false",
    );
  });

  it("keeps Tools, What it did and Usage when they fail to load, and says so", () => {
    viewMock.mockReturnValue(null);
    renderConsole({ integrations: null, stats: null, usage: null });

    for (const section of ["Connectors", "Stats", "Usage"]) {
      const heading = screen.getByRole("heading", {
        name: `Console.${section}.title`,
      });
      const region = heading.closest("section") as HTMLElement;
      expect(region).toHaveTextContent(`Console.LoadError.${section}`);
      expect(
        within(region).getByRole("button", { name: "Console.LoadError.retry" }),
      ).toBeInTheDocument();
    }
    // The rest of the page still works.
    expect(screen.getByTestId("schedule")).toBeInTheDocument();
    expect(screen.queryByTestId("connectors")).not.toBeInTheDocument();
  });

  it("loads the page again from a section's Try again", () => {
    viewMock.mockReturnValue(null);
    renderConsole({
      integrations: null,
      stats: { days: 30 } as SokoBotConsoleProps["stats"],
      usage: {} as SokoBotConsoleProps["usage"],
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Console.LoadError.retry" }),
    );
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("shows a loaded section with nothing in it, not a load error", () => {
    viewMock.mockReturnValue(null);
    renderConsole({
      integrations: { configured: true, integrations: [] },
      stats: { days: 30 } as SokoBotConsoleProps["stats"],
      usage: {} as SokoBotConsoleProps["usage"],
    });
    expect(screen.getByTestId("connectors")).toBeInTheDocument();
    expect(screen.getByTestId("daily-stats")).toBeInTheDocument();
    expect(screen.getByTestId("usage-summary")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Console.LoadError.retry" }),
    ).not.toBeInTheDocument();
  });

  it("shows schedules in the default view, not under Advanced", () => {
    viewMock.mockReturnValue(null);
    renderConsole({ canManage: false });
    expect(screen.getByTestId("schedule")).toHaveTextContent(BOT_ID);
    cleanup();
    viewMock.mockReturnValue("advanced");
    renderConsole({ canManage: false });
    expect(screen.queryByTestId("schedule")).not.toBeInTheDocument();
  });

  it("takes a schedule off the list as soon as its delete begins, and puts it back when the delete fails", () => {
    viewMock.mockReturnValue(null);
    const state = chatState(true);
    state.bot.schedules = [
      {
        id: "s1",
        name: "Morning check",
        systemKey: null,
        cronExpression: "0 9 * * *",
        timezone: "UTC",
        prompt: "Check the board",
        enabled: true,
        nextRunAt: "2030-01-02T09:00:00.000Z",
        consecutiveFailures: 0,
      } as (typeof state.bot.schedules)[number],
    ];
    render(consoleElement({ initialState: state }));
    expect(screen.getByText("Morning check")).toBeInTheDocument();

    act(() => rowActions.reportRemoved(true));
    expect(screen.queryByText("Morning check")).not.toBeInTheDocument();

    act(() => rowActions.reportRemoved(false));
    expect(screen.getByText("Morning check")).toBeInTheDocument();
  });

  it("reads a schedule's next run on its own clock, and the viewer's clock beside it", () => {
    viewMock.mockReturnValue(null);
    const state = chatState(true);
    state.bot.schedules = [
      {
        id: "s1",
        name: "Back up photo cards",
        systemKey: null,
        cronExpression: "0 16 * * 5",
        timezone: "Europe/Warsaw",
        prompt: "Remind me",
        enabled: true,
        nextRunAt: "2026-11-20T15:00:00.000Z",
        consecutiveFailures: 0,
      } as (typeof state.bot.schedules)[number],
    ];
    render(consoleElement({ initialState: state }));

    const row = screen.getByText("Back up photo cards").closest("li");
    expect(row).toHaveTextContent("Europe/Warsaw");
    expect(row).toHaveTextContent("Schedules.yourTime(date)");
  });

  it("says a switched-off schedule is off, with no next run", () => {
    viewMock.mockReturnValue(null);
    const state = chatState(true);
    state.bot.schedules = [
      {
        id: "s1",
        name: "Dreaming",
        systemKey: null,
        cronExpression: "0 3 * * *",
        timezone: "UTC",
        prompt: "Tidy memory",
        enabled: false,
        nextRunAt: "2030-01-02T03:00:00.000Z",
        lastRunAt: null,
        consecutiveFailures: 0,
      },
    ];
    render(consoleElement({ initialState: state }));

    const row = screen.getByText("Dreaming").closest("li");
    expect(row).toHaveTextContent("Schedules.disabled");
    expect(row).not.toHaveTextContent("Schedules.nextRun");
  });

  it("lands a chat card's schedule link on its row: scrolled to, focused and marked", () => {
    viewMock.mockReturnValue(null);
    scheduleParamMock.mockReturnValue("s2");
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const reduce = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: true } as MediaQueryList);
    const state = chatState(true);
    const schedule = {
      systemKey: null,
      cronExpression: "0 9 * * 1",
      timezone: "UTC",
      prompt: "Remind me",
      enabled: true,
      nextRunAt: "2030-01-02T09:00:00.000Z",
      lastRunAt: null,
      consecutiveFailures: 0,
    };
    state.bot.schedules = [
      { ...schedule, id: "s1", name: "Morning check" },
      { ...schedule, id: "s2", name: "Monday invoices" },
    ];
    render(consoleElement({ initialState: state }));

    const row = screen.getByText("Monday invoices").closest("li");
    expect(row).toHaveAttribute("aria-current", "true");
    expect(row).toHaveFocus();
    expect(screen.getByText("Morning check").closest("li")).not.toHaveAttribute(
      "aria-current",
    );
    // Reduced motion jumps instead of gliding.
    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: "center",
      behavior: "auto",
    });
    reduce.mockRestore();
  });

  it("jumps instead of smooth-scrolling after SSR hydration under reduced motion", async () => {
    viewMock.mockReturnValue(null);
    scheduleParamMock.mockReturnValue("s2");
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const reduce = vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({
          matches: query === "(prefers-reduced-motion: reduce)",
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    const state = chatState(true);
    state.bot.avatarImageUrl = "https://example.com/bot.png";
    const schedule = {
      systemKey: null,
      cronExpression: "0 9 * * 1",
      timezone: "UTC",
      prompt: "Remind me",
      enabled: true,
      nextRunAt: "2030-01-02T09:00:00.000Z",
      lastRunAt: null,
      consecutiveFailures: 0,
    };
    state.bot.schedules = [
      { ...schedule, id: "s1", name: "Morning check" },
      { ...schedule, id: "s2", name: "Monday invoices" },
    ];

    const container = document.createElement("div");
    const props = { initialState: state };
    container.innerHTML = renderToString(consoleElement(props));
    document.body.append(container);

    let root: Root | null = null;
    try {
      await act(async () => {
        root = hydrateRoot(container, consoleElement(props));
      });
      expect(scrollIntoView).toHaveBeenCalledOnce();
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "center",
        behavior: "auto",
      });
    } finally {
      await act(async () => root?.unmount());
      container.remove();
      reduce.mockRestore();
    }
  });

  it("lets the keyboard reach and scroll the memory", () => {
    const state = chatState(true);
    state.bot.memory = {
      markdown: renderSokoBotMemory({
        ...createEmptySokoBotMemory(),
        preferences: ["Short replies"],
      }),
      createdAt: "2026-10-29T12:00:00Z",
    } as NonNullable<SokoBotChatState["bot"]["memory"]>;
    renderConsole({ initialState: state });
    expect(
      screen.getByRole("region", { name: "Memory.title" }),
    ).toHaveAttribute("tabindex", "0");
  });

  it("says a new bot's memory is empty instead of listing None five times", () => {
    const state = chatState(true);
    state.bot.memory = {
      markdown: renderSokoBotMemory(createEmptySokoBotMemory()),
      createdAt: "2026-10-29T12:00:00Z",
    } as NonNullable<SokoBotChatState["bot"]["memory"]>;
    renderConsole({ initialState: state });
    expect(screen.getByText("Memory.empty")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Memory.title" })).toBeNull();
  });

  it("hides skills and avatar on a shared bot, and reads it by id", () => {
    const element = consoleElement({});
    // The live state Core holds for that bot id; any other id reads stale.
    useStateMock.mockImplementation(
      (initial: SokoBotChatState, id: string | null) => ({
        state:
          id === BOT_ID
            ? { ...initial, bot: { ...initial.bot, name: "Ops live" } }
            : initial,
        refresh: vi.fn(),
      }),
    );
    render(element);
    expect(screen.queryByTestId("skills")).not.toBeInTheDocument();
    expect(screen.queryByTestId("avatar")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Ops live" }),
    ).toBeInTheDocument();
  });

  it("keeps skills, avatar and the own-bot target on the caller's own bot", () => {
    renderConsole({ botId: null, sharedRoomId: null });
    expect(screen.getByTestId("skills")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "edit" })).toBeInTheDocument();
    expect(screen.getByTestId("archive")).toHaveTextContent("own");
    expect(screen.getByText("Settings.archiveDescription")).toBeInTheDocument();
  });

  it("opens the studio on the bot's current look and refreshes once it is saved", async () => {
    const refresh = vi.fn();
    const element = consoleElement({
      botId: null,
      sharedRoomId: null,
      initialState: stateWith({ avatarCode: "v1-code" }),
    });
    useStateMock.mockReturnValue({
      state: stateWith({ avatarCode: "v1-code" }),
      refresh,
    });
    render(element);
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(await screen.findByTestId("avatar")).toHaveAttribute(
      "data-code",
      "v1-code",
    );
    fireEvent.click(screen.getByRole("button", { name: "save look" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens a shared bot's room instead of a direct room", () => {
    renderConsole({});
    fireEvent.click(screen.getByRole("button", { name: "Console.openChat" }));
    expect(pushMock).toHaveBeenCalledWith("/chat/rooms/room-1");
    expect(ensureRoomMock).not.toHaveBeenCalled();
  });

  it("reports an error when a shared bot has no room", () => {
    renderConsole({ sharedRoomId: null });
    fireEvent.click(screen.getByRole("button", { name: "Console.openChat" }));
    expect(pushMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith("Console.openChatError");
  });

  describe("Ads section", () => {
    const connected = { configured: true, integrations: [] };

    it("is only under Advanced", () => {
      viewMock.mockReturnValue(null);
      renderConsole({
        integrations: connected,
        ads: { accounts: [], projectId: "p1" },
      });
      expect(screen.queryByTestId("ads")).not.toBeInTheDocument();
      cleanup();
      viewMock.mockReturnValue("advanced");
      renderConsole({
        integrations: connected,
        ads: { accounts: [], projectId: "p1" },
      });
      expect(screen.getByTestId("ads")).toHaveTextContent("p1");
    });

    it("leaves the tools to the default view", () => {
      viewMock.mockReturnValue(null);
      renderConsole({ integrations: connected });
      expect(screen.getByTestId("connectors")).toBeInTheDocument();
      cleanup();
      viewMock.mockReturnValue("advanced");
      renderConsole({ integrations: connected });
      expect(screen.queryByTestId("connectors")).not.toBeInTheDocument();
      expect(screen.queryByTestId("integrations")).not.toBeInTheDocument();
    });

    it.each([null, "advanced"])(
      "is absent without the Social beta (view %s)",
      (view) => {
        viewMock.mockReturnValue(view);
        renderConsole({ integrations: connected, ads: null });
        expect(screen.queryByTestId("ads")).not.toBeInTheDocument();
        expect(screen.queryByText("Ads.title")).not.toBeInTheDocument();
      },
    );
  });
});

function stateWith(bot: Partial<SokoBotChatState["bot"]>): SokoBotChatState {
  const state = chatState(true);
  return { ...state, bot: { ...state.bot, ...bot } };
}

describe("SokoBotConsole header portrait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewMock.mockReturnValue(null);
  });

  it("shows the bot's one picture whatever it is doing, and never a loop", () => {
    const { rerender } = renderConsole({
      initialState: stateWith({
        status: "RUNNING",
        avatarImageUrl: "https://blob/avatar.webp",
      }),
    });
    expect(screen.getByRole("img", { name: "Ops" })).toHaveAttribute(
      "src",
      "https://blob/avatar.webp",
    );
    expect(document.querySelector("video")).toBeNull();

    rerender(
      consoleElement({
        initialState: stateWith({
          status: "IDLE",
          avatarImageUrl: "https://blob/avatar.webp",
        }),
      }),
    );
    expect(screen.getByRole("img", { name: "Ops" })).toHaveAttribute(
      "src",
      "https://blob/avatar.webp",
    );
  });

  it("draws the orb for a bot with no picture", () => {
    renderConsole({ initialState: stateWith({ avatarImageUrl: null }) });
    expect(
      screen.queryByRole("img", { name: "Ops" })?.getAttribute("src") ?? null,
    ).toBeNull();
  });

  it("names the bot's status in its badge and says when it was last active", () => {
    renderConsole({
      initialState: stateWith({
        status: "RUNNING",
        lastActivityAt: "2026-10-29T11:00:00Z",
      }),
    });
    expect(screen.getByText("RUNNING")).toBeInTheDocument();
    expect(screen.getByText("Console.lastActivity(now)")).toBeInTheDocument();
  });

  it("says its last reply failed, and only then", () => {
    const { rerender } = renderConsole({
      initialState: stateWith({ status: "ERROR" }),
    });
    expect(screen.getByText(/Console\.lastTurnFailed/)).toBeInTheDocument();

    rerender(consoleElement({ initialState: stateWith({ status: "IDLE" }) }));
    expect(screen.queryByText(/Console\.lastTurnFailed/)).toBeNull();
  });

  it("edits only the own bot's picture, from its avatar", async () => {
    renderConsole({ botId: null, sharedRoomId: null });
    expect(screen.queryByTestId("avatar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "edit" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "edit" })).toBeNull();
    cleanup();
    renderConsole({ canManage: true });
    expect(screen.queryByRole("button", { name: "edit" })).toBeNull();
  });
});
