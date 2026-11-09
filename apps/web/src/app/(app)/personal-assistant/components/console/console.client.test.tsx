import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useContext } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

import { SokoBotTargetContext } from "../soko-bot-target";
import { SokoBotConsole, type SokoBotConsoleProps } from "./console.client";

const pushMock = vi.fn();
const toastErrorMock = vi.fn();
const ensureRoomMock = vi.fn();
const useStateMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}(${Object.values(values).join(",")})` : key,
  useFormatter: () => ({
    dateTime: () => "date",
    relativeTime: () => "now",
  }),
  useNow: () => new Date("2026-10-29T12:00:00Z"),
}));
const viewMock = vi.fn(() => "advanced" as string | null);
vi.mock("nuqs", () => ({ useQueryState: () => [viewMock(), vi.fn()] }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastErrorMock(...a) },
}));
vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: (...a: unknown[]) => ensureRoomMock(...a),
}));
const claimAvatarMock = vi.fn();
vi.mock("@/lib/actions/soko-bot/action", () => ({
  claimSokoBotAvatarAction: (...a: unknown[]) => claimAvatarMock(...a),
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
vi.mock("../avatar-picker.client", () => ({
  AvatarPicker: ({
    onChange,
  }: {
    onChange: (avatar: { id: string; imageUrl: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="avatar"
      onClick={() =>
        onChange({ id: "avatar-7", imageUrl: "https://blob/avatar-7.png" })
      }
    >
      pick avatar-7
    </button>
  ),
}));
vi.mock("../schedule-form.client", () => ({
  ScheduleForm: () => <TargetProbe name="schedule" />,
}));
vi.mock("../schedule-row-actions.client", () => ({
  ScheduleRowActions: () => null,
}));
vi.mock("../proactive-settings.client", () => ({
  ProactiveSettings: () => null,
}));
vi.mock("../follow-board-toggle.client", () => ({
  FollowBoardToggle: () => null,
}));
vi.mock("../integrations-section.client", () => ({
  IntegrationsSection: () => <span data-testid="integrations" />,
}));
vi.mock("./tool-connectors.client", () => ({
  ToolConnectors: () => <span data-testid="connectors" />,
}));
vi.mock("../ad-accounts-section", () => ({
  AdAccountsSection: ({ botProjectId }: { botProjectId: string | null }) => (
    <span data-testid="ads">{botProjectId ?? "all"}</span>
  ),
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

  it("shows schedules in the default view, not under Advanced", () => {
    viewMock.mockReturnValue(null);
    renderConsole({ canManage: false });
    expect(screen.getByTestId("schedule")).toHaveTextContent(BOT_ID);
    cleanup();
    viewMock.mockReturnValue("advanced");
    renderConsole({ canManage: false });
    expect(screen.queryByTestId("schedule")).not.toBeInTheDocument();
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
    expect(screen.getByTestId("avatar")).toBeInTheDocument();
    expect(screen.getByTestId("archive")).toHaveTextContent("own");
    expect(screen.getByText("Settings.archiveDescription")).toBeInTheDocument();
  });

  it("changes the own bot's avatar to the one picked in the console", async () => {
    claimAvatarMock.mockResolvedValue({ ok: true });
    renderConsole({ botId: null, sharedRoomId: null });
    fireEvent.click(screen.getByRole("button", { name: "pick avatar-7" }));
    fireEvent.click(screen.getByRole("button", { name: "Avatar.save" }));
    await waitFor(() =>
      expect(claimAvatarMock).toHaveBeenCalledWith({ avatarId: "avatar-7" }),
    );
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
        avatarImageUrl: "https://blob/mascot.webp",
      }),
    });
    expect(screen.getByRole("img", { name: "Ops" })).toHaveAttribute(
      "src",
      "https://blob/mascot.webp",
    );
    expect(document.querySelector("video")).toBeNull();

    rerender(
      consoleElement({
        initialState: stateWith({
          status: "IDLE",
          avatarImageUrl: "https://blob/mascot.webp",
        }),
      }),
    );
    expect(screen.getByRole("img", { name: "Ops" })).toHaveAttribute(
      "src",
      "https://blob/mascot.webp",
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

  it("offers no way to the avatar studio, own bot or shared", () => {
    renderConsole({ canManage: true });
    expect(screen.queryByRole("link", { name: "edit" })).toBeNull();
    cleanup();
    renderConsole({ botId: null, sharedRoomId: null });
    expect(screen.queryByRole("link", { name: "edit" })).toBeNull();
  });
});
