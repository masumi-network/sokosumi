import type { SokoBotAvatarView } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SokoBotChatState } from "@/lib/soko-bot/chat-state";

import { SokoBotTargetContext } from "../soko-bot-target";
import { SokoBotConsole, type SokoBotConsoleProps } from "./console.client";

const reduceMotion = vi.hoisted(() => ({ current: false }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => reduceMotion.current,
}));

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
      avatarState: "idle",
      avatar: null,
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
      catalog={[]}
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

  describe("Ads section", () => {
    const connected = { configured: true, integrations: [] };

    it("sits right after the connectors in the default view", () => {
      viewMock.mockReturnValue(null);
      renderConsole({
        integrations: connected,
        ads: { accounts: [], projectId: "p1" },
      });
      const connectors = screen.getByTestId("connectors");
      const ads = screen.getByTestId("ads");
      expect(ads).toHaveTextContent("p1");
      expect(screen.getByText("Ads.title")).toBeInTheDocument();
      expect(
        connectors.compareDocumentPosition(ads) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("sits right after the integrations under Advanced", () => {
      renderConsole({
        integrations: connected,
        ads: { accounts: [], projectId: null },
      });
      const integrationsEl = screen.getByTestId("integrations");
      const ads = screen.getByTestId("ads");
      expect(
        integrationsEl.compareDocumentPosition(ads) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
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

const NO_STATES = {
  idle: null,
  thinking: null,
  working: null,
  done: null,
  needs_you: null,
  offline: null,
};

function stateAssets(name: string) {
  return {
    stillUrl: `https://blob/${name}.png`,
    loopUrl: `https://blob/${name}-480.mp4`,
    loopLargeUrl: `https://blob/${name}-960.mp4`,
  };
}

const CRAFTED: SokoBotAvatarView = {
  styleId: "crafted-desk",
  styleVersion: 1,
  stillUrl: "https://blob/idle.png",
  states: {
    ...NO_STATES,
    idle: stateAssets("idle"),
    working: stateAssets("working"),
    done: stateAssets("done"),
  },
};

function craftedState(
  avatarState: "idle" | "working" | "done",
): SokoBotChatState {
  const state = chatState(true);
  return {
    ...state,
    bot: {
      ...state.bot,
      avatarState,
      avatar: CRAFTED,
      avatarImageUrl: CRAFTED.stillUrl,
    },
  };
}

function reducedMotion(matches: boolean) {
  reduceMotion.current = matches;
}

function portrait() {
  return screen.getByRole("img", { name: /^alt\(/ });
}

function loop() {
  return document.querySelector("video");
}

describe("SokoBotConsole header portrait", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewMock.mockReturnValue(null);
    reducedMotion(false);
    // No media playback in the test DOM: a loop is a video that never plays.
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
  });
  afterEach(() => {
    reduceMotion.current = false;
  });

  it("plays the current state once on mount, then rests on its still", () => {
    renderConsole({ initialState: craftedState("working") });
    expect(loop()).toHaveAttribute("src", "https://blob/working-960.mp4");
    expect(loop()).toHaveAttribute("poster", "https://blob/working.png");
    expect(loop()).toHaveAttribute("aria-hidden", "true");
    expect(loop()).not.toHaveAttribute("loop");
    expect(portrait()).toHaveAttribute("alt", "alt(Ops,label.working)");

    fireEvent.ended(loop() as HTMLVideoElement);

    expect(loop()).toBeNull();
    expect(portrait()).toHaveAttribute("src", "https://blob/working.png");
  });

  it("plays again whenever the state changes", () => {
    const { rerender } = renderConsole({
      initialState: craftedState("working"),
    });
    fireEvent.ended(loop() as HTMLVideoElement);
    expect(loop()).toBeNull();

    rerender(consoleElement({ initialState: craftedState("done") }));
    expect(loop()).toHaveAttribute("src", "https://blob/done-960.mp4");
    expect(loop()).toHaveAttribute("poster", "https://blob/done.png");

    fireEvent.ended(loop() as HTMLVideoElement);
    expect(loop()).toBeNull();
    expect(portrait()).toHaveAttribute("src", "https://blob/done.png");
  });

  it("rests on the still when the clip cannot play", () => {
    renderConsole({ initialState: craftedState("working") });
    fireEvent.error(loop() as HTMLVideoElement);
    expect(loop()).toBeNull();
    expect(portrait()).toHaveAttribute("src", "https://blob/working.png");
  });

  it("shows only stills under reduced motion", () => {
    reducedMotion(true);
    renderConsole({ initialState: craftedState("working") });
    expect(loop()).toBeNull();
    expect(portrait()).toHaveAttribute("src", "https://blob/working.png");
  });

  it("shows a legacy mascot's one image and never moves", () => {
    const state = chatState(true);
    renderConsole({
      initialState: {
        ...state,
        bot: {
          ...state.bot,
          avatarState: "working",
          avatarImageUrl: "https://blob/mascot.png",
          avatar: {
            styleId: "mascot",
            styleVersion: 1,
            stillUrl: "https://blob/mascot.png",
            states: NO_STATES,
          },
        },
      },
    });
    expect(loop()).toBeNull();
    expect(portrait()).toHaveAttribute("src", "https://blob/mascot.png");
  });

  it("names the state in a pill, with the sweep only while busy", () => {
    const { rerender } = renderConsole({
      initialState: craftedState("working"),
    });
    expect(screen.getByText("label.working")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="button-loading-bar"]'),
    ).not.toBeNull();

    rerender(consoleElement({ initialState: craftedState("done") }));
    expect(screen.getByText("label.done")).toBeInTheDocument();
    expect(
      document.querySelector('[data-slot="button-loading-bar"]'),
    ).toBeNull();
  });

  it("links the Edit avatar badge to the studio for someone who can manage the bot", () => {
    renderConsole({ canManage: true });
    expect(screen.getByRole("link", { name: "edit" })).toHaveAttribute(
      "href",
      `/soko-bots/${BOT_ID}/avatar`,
    );
  });

  it("links the studio of one's own bot under the assistant route", () => {
    renderConsole({ botId: null, sharedRoomId: null });
    expect(screen.getByRole("link", { name: "edit" })).toHaveAttribute(
      "href",
      "/personal-assistant/avatar",
    );
  });

  it("hides the Edit avatar badge from a member who cannot manage the bot", () => {
    renderConsole({ canManage: false });
    expect(screen.queryByRole("link", { name: "edit" })).toBeNull();
  });
});
