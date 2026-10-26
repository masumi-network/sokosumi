import { fireEvent, render, screen } from "@testing-library/react";
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
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({
    dateTime: () => "date",
    relativeTime: () => "now",
  }),
}));
vi.mock("nuqs", () => ({ useQueryState: () => ["advanced", vi.fn()] }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastErrorMock(...a) },
}));
vi.mock("@/app/chat/actions", () => ({
  ensureSokoBotDirectRoomAction: (...a: unknown[]) => ensureRoomMock(...a),
}));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  claimSokoBotAvatarAction: vi.fn(),
}));
vi.mock("../chat/use-soko-bot-state", () => ({
  useSokoBotState: (...a: unknown[]) => useStateMock(...a),
}));
vi.mock("../chat/assistant-avatar", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../chat/assistant-avatar")>()),
  AssistantAvatar: () => <span />,
}));

/** Reports the bot id the panels would act on. */
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
  AvatarPicker: () => <span data-testid="avatar" />,
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
  IntegrationsSection: () => null,
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

function renderConsole(overrides: Partial<SokoBotConsoleProps>): void {
  const initialState = overrides.initialState ?? chatState(true);
  useStateMock.mockReturnValue({ state: initialState, refresh: vi.fn() });
  render(
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
      catalog={[]}
      integrationOutcome={null}
      paidByOrganization
      botId={BOT_ID}
      canManage
      sharedRoomId="room-1"
      {...overrides}
    />,
  );
}

describe("SokoBotConsole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(screen.getByTestId("schedule")).toHaveTextContent(BOT_ID);
  });

  it("hides skills and avatar on a shared bot, and reads it by id", () => {
    renderConsole({});
    expect(screen.queryByTestId("skills")).not.toBeInTheDocument();
    expect(screen.queryByTestId("avatar")).not.toBeInTheDocument();
    expect(useStateMock).toHaveBeenCalledWith(expect.anything(), BOT_ID);
  });

  it("keeps skills, avatar and the own-bot target on the caller's own bot", () => {
    renderConsole({ botId: null, sharedRoomId: null });
    expect(screen.getByTestId("skills")).toBeInTheDocument();
    expect(screen.getByTestId("avatar")).toBeInTheDocument();
    expect(screen.getByTestId("archive")).toHaveTextContent("own");
    expect(screen.getByText("Settings.archiveDescription")).toBeInTheDocument();
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
});
