import type {
  SokoBotAvatarDraft,
  SokoBotAvatarStudio,
} from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMock,
  keepMock,
  discardMock,
  regenerateMock,
  refreshMock,
  toastErrorMock,
} = vi.hoisted(() => ({
  createMock: vi.fn(),
  keepMock: vi.fn(),
  discardMock: vi.fn(),
  regenerateMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

const reduceMotion = vi.hoisted(() => ({ current: false }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => reduceMotion.current,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));
// Only `creatures.owl` has a translation here; the rest fall back to the id.
vi.mock("next-intl", () => ({
  useTranslations: () =>
    Object.assign(
      (key: string, values?: Record<string, string>) =>
        values ? `${key}(${Object.values(values).join(",")})` : key,
      { has: (key: string) => key === "creatures.owl" },
    ),
}));
vi.mock("sonner", () => ({ toast: { error: toastErrorMock } }));
vi.mock("@/lib/actions/soko-bot/action", () => ({
  createSokoBotAvatarDraftAction: createMock,
  keepSokoBotAvatarDraftAction: keepMock,
  discardSokoBotAvatarDraftsAction: discardMock,
  regenerateSokoBotAvatarStateAction: regenerateMock,
}));

import { AvatarStudio } from "./avatar-studio.client";

const BOT_ID = "8a7f2c1e-4b3d-4e5f-9a8b-1c2d3e4f5a6b";
const DRAFT_ID = "5f1c2d3e-4b3d-4e5f-9a8b-8a7f2c1e4b3d";

const NO_STATES = {
  idle: null,
  thinking: null,
  working: null,
  done: null,
  needs_you: null,
  offline: null,
};

function assets(name: string) {
  return {
    stillUrl: `https://blob/${name}.png`,
    loopUrl: `https://blob/${name}-480.mp4`,
    loopLargeUrl: `https://blob/${name}-960.mp4`,
  };
}

const studio: SokoBotAvatarStudio = {
  avatar: {
    styleId: "crafted-desk",
    styleVersion: 1,
    stillUrl: "https://blob/idle.png",
    states: { ...NO_STATES, idle: assets("idle"), working: assets("working") },
  },
  look: { creature: "owl", accessories: ["glasses"], typed: [] },
  draft: null,
  progress: { ready: 6, failed: 0, total: 6 },
  options: {
    creatures: [{ id: "owl" }, { id: "frog" }],
    accessories: [{ id: "glasses" }, { id: "scarf" }],
  },
};

function draft(creature: string): SokoBotAvatarDraft {
  return {
    id: DRAFT_ID,
    imageUrl: `https://blob/draft-${creature}.png`,
    look: { creature, accessories: ["glasses"], typed: [] },
    expiresAt: new Date("2026-10-30T00:00:00Z"),
  };
}

function renderStudio(
  initial: SokoBotAvatarStudio = studio,
  botId: string | null = null,
) {
  return render(
    <AvatarStudio
      botId={botId}
      botName="Ops"
      consoleHref="/personal-assistant"
      initial={initial}
    />,
  );
}

/** The large look: the one image named after the bot. */
function look() {
  return screen.getAllByRole("img")[0];
}

async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("AvatarStudio", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    reduceMotion.current = false;
    // No media playback in the test DOM: a loop is a video that never plays.
    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: vi.fn(() => Promise.resolve()),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens on the current look with the creature and accessories it has", () => {
    renderStudio();
    expect(look()).toHaveAttribute("src", "https://blob/idle.png");
    expect(
      screen.getByRole("button", { name: "creatures.owl" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Frog" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Glasses" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "keep" })).toBeDisabled();
  });

  it("sends a creature change and shows the draft", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { draft: draft("frog"), note: "" },
    });
    renderStudio();

    await click(screen.getByRole("button", { name: "Frog" }));

    expect(createMock).toHaveBeenCalledWith({
      botId: undefined,
      input: {
        change: { kind: "creature", creature: "frog" },
        draftId: undefined,
      },
    });
    expect(look()).toHaveAttribute("src", "https://blob/draft-frog.png");
    expect(screen.getByRole("button", { name: "keep" })).toBeEnabled();
  });

  it("toggles accessories on and off, editing the draft once there is one", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { draft: draft("owl"), note: "" },
    });
    renderStudio();

    await click(screen.getByRole("button", { name: "Scarf" }));
    expect(createMock).toHaveBeenLastCalledWith({
      botId: undefined,
      input: {
        change: { kind: "accessory", accessory: "scarf", enabled: true },
        draftId: undefined,
      },
    });

    await click(screen.getByRole("button", { name: "Glasses" }));
    expect(createMock).toHaveBeenLastCalledWith({
      botId: undefined,
      input: {
        change: { kind: "accessory", accessory: "glasses", enabled: false },
        draftId: DRAFT_ID,
      },
    });
  });

  it("sends typed text and ideas as typed changes", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { draft: draft("owl"), note: "Added a hat." },
    });
    renderStudio();

    fireEvent.change(screen.getByLabelText("describe"), {
      target: { value: "  a red scarf  " },
    });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("describe").closest("form")!);
    });
    expect(createMock).toHaveBeenLastCalledWith({
      botId: undefined,
      input: {
        change: { kind: "typed", text: "a red scarf" },
        draftId: undefined,
      },
    });
    expect(screen.getByText("Added a hat.")).toBeInTheDocument();

    await click(screen.getByRole("button", { name: "ideas.coffee" }));
    expect(createMock).toHaveBeenLastCalledWith({
      botId: undefined,
      input: {
        change: { kind: "typed", text: "ideas.coffee" },
        draftId: DRAFT_ID,
      },
    });
  });

  it("offers only original ideas", () => {
    renderStudio();
    const ideas = screen
      .getAllByRole("button", { name: /^ideas\./ })
      .map((button) => button.textContent);
    expect(ideas).toEqual([
      "ideas.wizard",
      "ideas.coffee",
      "ideas.snow",
      "ideas.sleepy",
      "ideas.beach",
    ]);
  });

  it("shuffles without a draft id", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { draft: draft("frog"), note: "" },
    });
    renderStudio(studio, BOT_ID);

    await click(screen.getByRole("button", { name: "shuffle" }));
    await click(screen.getByRole("button", { name: "shuffle" }));

    expect(createMock).toHaveBeenLastCalledWith({
      botId: BOT_ID,
      input: { change: { kind: "shuffle" }, draftId: undefined },
    });
  });

  it("shows the note and leaves the look alone when the rewriter refuses", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { draft: null, note: "That is a copyrighted character." },
    });
    renderStudio();

    await click(screen.getByRole("button", { name: "ideas.wizard" }));

    expect(
      screen.getByText("That is a copyrighted character."),
    ).toBeInTheDocument();
    expect(look()).toHaveAttribute("src", "https://blob/idle.png");
    expect(screen.getByRole("button", { name: "keep" })).toBeDisabled();
  });

  it("says so plainly when the cap is reached", async () => {
    createMock.mockResolvedValue({
      ok: false,
      error: { code: "SOKO_BOT_AVATAR_RATE_LIMITED", message: "slow down" },
    });
    renderStudio();

    await click(screen.getByRole("button", { name: "shuffle" }));

    expect(toastErrorMock).toHaveBeenCalledWith("rateLimited");
    expect(look()).toHaveAttribute("src", "https://blob/idle.png");
  });

  it("says plainly when drawing is switched off", async () => {
    createMock.mockResolvedValue({
      ok: false,
      error: { code: "SOKO_BOT_AVATAR_UNAVAILABLE", message: "off" },
    });
    renderStudio();

    await click(screen.getByRole("button", { name: "shuffle" }));

    expect(toastErrorMock).toHaveBeenCalledWith("unavailable");
    expect(look()).toHaveAttribute("src", "https://blob/idle.png");
  });

  it("reports another failure without changing the look", async () => {
    createMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL", message: "boom" },
    });
    renderStudio();

    await click(screen.getByRole("button", { name: "shuffle" }));

    expect(toastErrorMock).toHaveBeenCalledWith("error");
  });

  it("holds the states back until a draft is kept", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { draft: draft("frog"), note: "" },
    });
    renderStudio();
    expect(screen.getByText("statesPlay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "label.working" })).toBeEnabled();

    await click(screen.getByRole("button", { name: "Frog" }));

    expect(screen.getByText("statesDraft")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "label.working" }),
    ).toBeDisabled();
  });

  it("disables a state that has no render yet", () => {
    renderStudio();
    expect(screen.getByRole("button", { name: "label.done" })).toBeDisabled();
  });

  it("shows which states are being drawn and which animated while a look renders", () => {
    renderStudio({
      ...studio,
      avatar: {
        ...(studio.avatar as NonNullable<SokoBotAvatarStudio["avatar"]>),
        states: {
          ...NO_STATES,
          idle: assets("idle"),
          working: {
            stillUrl: "https://blob/working.png",
            loopUrl: null,
            loopLargeUrl: null,
          },
        },
      },
      progress: { ready: 1, failed: 0, total: 6 },
    });

    const tile = (state: string) =>
      screen.getByRole("button", { name: new RegExp(`label\\.${state}`) });
    // Its still is in: it can be picked while its loop is made.
    expect(tile("working")).toBeEnabled();
    expect(tile("working")).toHaveTextContent("animating");
    // No still yet: nothing to pick.
    expect(tile("done")).toBeDisabled();
    expect(tile("done")).toHaveTextContent("drawing");
    expect(tile("idle")).not.toHaveTextContent(/drawing|animating/);
  });

  it("offers no redo for a state making its first loop", () => {
    renderStudio({
      ...studio,
      avatar: {
        ...(studio.avatar as NonNullable<SokoBotAvatarStudio["avatar"]>),
        states: {
          ...NO_STATES,
          idle: {
            stillUrl: "https://blob/idle.png",
            loopUrl: null,
            loopLargeUrl: null,
          },
        },
      },
      progress: { ready: 0, failed: 0, total: 6 },
    });
    expect(
      screen.queryByRole("button", { name: /redo|retry|redoing/ }),
    ).toBeNull();
  });

  it("says nothing is being made once every state is in", () => {
    renderStudio();
    expect(screen.queryByText(/drawing|animating/)).toBeNull();
  });

  describe("a picked state", () => {
    const video = () => document.querySelector("video");

    it("plays once, then rests on its still", async () => {
      renderStudio();
      expect(video()).toBeNull();

      await click(screen.getByRole("button", { name: "label.working" }));
      expect(video()).toHaveAttribute("src", "https://blob/working-960.mp4");
      expect(video()).toHaveAttribute("poster", "https://blob/working.png");
      expect(video()).not.toHaveAttribute("loop");

      fireEvent.ended(video() as HTMLVideoElement);
      expect(video()).toBeNull();
      expect(look()).toHaveAttribute("src", "https://blob/working.png");
    });

    it("plays again when the same state is picked again", async () => {
      renderStudio();
      await click(screen.getByRole("button", { name: "label.working" }));
      fireEvent.ended(video() as HTMLVideoElement);
      expect(video()).toBeNull();

      await click(screen.getByRole("button", { name: "label.working" }));

      expect(video()).toHaveAttribute("src", "https://blob/working-960.mp4");
    });

    it("stays a still under reduced motion", async () => {
      reduceMotion.current = true;
      renderStudio();

      await click(screen.getByRole("button", { name: "label.working" }));

      expect(video()).toBeNull();
      expect(look()).toHaveAttribute("src", "https://blob/working.png");
    });
  });

  describe("Redo animation", () => {
    const video = () => document.querySelector("video");
    const rendering = { ready: 5, failed: 0, total: 6 };

    /** The kept look with `done` having a still but no loop: its render failed. */
    const withFailedDone: SokoBotAvatarStudio = {
      ...studio,
      avatar: {
        ...(studio.avatar as NonNullable<SokoBotAvatarStudio["avatar"]>),
        states: {
          ...(studio.avatar as NonNullable<SokoBotAvatarStudio["avatar"]>)
            .states,
          done: {
            stillUrl: "https://blob/done.png",
            loopUrl: null,
            loopLargeUrl: null,
          },
        },
      },
      progress: { ready: 5, failed: 1, total: 6 },
    };

    it("is offered for the picked state of the kept look", () => {
      renderStudio();
      expect(screen.getByRole("button", { name: "redo" })).toBeEnabled();
    });

    it("says Try again for a state whose animation failed", async () => {
      renderStudio(withFailedDone);
      await click(screen.getByRole("button", { name: "label.done" }));

      expect(screen.getByRole("button", { name: "retry" })).toBeEnabled();
      expect(screen.queryByRole("button", { name: "redo" })).toBeNull();
    });

    it("is hidden while a draft is open", async () => {
      createMock.mockResolvedValue({
        ok: true,
        value: { draft: draft("frog"), note: "" },
      });
      renderStudio();
      await click(screen.getByRole("button", { name: "Frog" }));

      expect(screen.queryByRole("button", { name: "redo" })).toBeNull();
    });

    it("is hidden for a legacy mascot and for a look with no renders", () => {
      const { unmount } = renderStudio({
        ...studio,
        avatar: {
          styleId: "mascot",
          styleVersion: 1,
          stillUrl: "https://blob/mascot.png",
          states: NO_STATES,
        },
        look: null,
        progress: { ready: 0, failed: 0, total: 0 },
      });
      expect(screen.queryByRole("button", { name: /redo|retry/ })).toBeNull();
      unmount();

      renderStudio({ ...studio, progress: { ready: 0, failed: 0, total: 0 } });
      expect(screen.queryByRole("button", { name: /redo|retry/ })).toBeNull();
    });

    it("is hidden when the picked state has no render at all", () => {
      renderStudio({
        ...studio,
        avatar: {
          ...(studio.avatar as NonNullable<SokoBotAvatarStudio["avatar"]>),
          states: { ...NO_STATES },
        },
      });
      expect(screen.queryByRole("button", { name: /redo|retry/ })).toBeNull();
    });

    it("redoes the picked state of this bot and shows it is being made", async () => {
      regenerateMock.mockResolvedValue({
        ok: true,
        value: { ...studio, progress: rendering },
      });
      renderStudio(studio, BOT_ID);
      await click(screen.getByRole("button", { name: "label.working" }));
      fireEvent.ended(video() as HTMLVideoElement);

      await click(screen.getByRole("button", { name: "redo" }));

      expect(regenerateMock).toHaveBeenCalledWith({
        botId: BOT_ID,
        state: "working",
      });
      // The tile and the button both say so; the old loop is not touched.
      expect(
        screen.getByRole("button", { name: /label\.working/ }),
      ).toHaveTextContent("animating");
      expect(screen.getByRole("button", { name: "redoing" })).toBeDisabled();
    });

    it("polls, then plays the new loop once when it lands", async () => {
      regenerateMock.mockResolvedValue({
        ok: true,
        value: { ...studio, progress: rendering },
      });
      const landedAvatar = {
        ...(studio.avatar as NonNullable<SokoBotAvatarStudio["avatar"]>),
        states: {
          ...(studio.avatar as NonNullable<SokoBotAvatarStudio["avatar"]>)
            .states,
          working: {
            stillUrl: "https://blob/working.png",
            loopUrl: "https://blob/working-new-480.mp4",
            loopLargeUrl: "https://blob/working-new-960.mp4",
          },
        },
      };
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({
          studio: {
            avatar: landedAvatar,
            progress: { ready: 6, failed: 0, total: 6 },
          },
        }),
      }));
      vi.stubGlobal("fetch", fetchMock);
      renderStudio(studio, BOT_ID);
      await click(screen.getByRole("button", { name: "label.working" }));
      fireEvent.ended(video() as HTMLVideoElement);
      await click(screen.getByRole("button", { name: "redo" }));
      expect(video()).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(5_000);
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      expect(screen.queryByText(/redoing|animating/)).toBeNull();
      expect(video()).toHaveAttribute(
        "src",
        "https://blob/working-new-960.mp4",
      );
      fireEvent.ended(video() as HTMLVideoElement);
      expect(video()).toBeNull();
    });

    it("says plainly when that animation is still being made", async () => {
      regenerateMock.mockResolvedValue({
        ok: false,
        error: { code: "SOKO_BOT_AVATAR_STATE_RENDERING", message: "busy" },
      });
      renderStudio();

      await click(screen.getByRole("button", { name: "redo" }));

      expect(toastErrorMock).toHaveBeenCalledWith("redoBusy");
      expect(screen.getByRole("button", { name: "redo" })).toBeEnabled();
    });

    it("says plainly when the day's redos are spent", async () => {
      regenerateMock.mockResolvedValue({
        ok: false,
        error: { code: "SOKO_BOT_AVATAR_REDO_LIMIT", message: "limit" },
      });
      renderStudio();

      await click(screen.getByRole("button", { name: "redo" }));

      expect(toastErrorMock).toHaveBeenCalledWith("redoLimit");
    });

    it("reports any other failure", async () => {
      regenerateMock.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL", message: "boom" },
      });
      renderStudio();

      await click(screen.getByRole("button", { name: "redo" }));

      expect(toastErrorMock).toHaveBeenCalledWith("redoError");
    });
  });

  describe("Cancel", () => {
    beforeEach(() => {
      createMock.mockResolvedValue({
        ok: true,
        value: { draft: draft("frog"), note: "" },
      });
    });

    it("is not offered while there is no draft", () => {
      renderStudio();
      expect(screen.queryByRole("button", { name: "cancel" })).toBeNull();
    });

    it("is offered next to Keep once a draft exists", async () => {
      renderStudio();
      await click(screen.getByRole("button", { name: "Frog" }));
      expect(screen.getByRole("button", { name: "cancel" })).toBeEnabled();
    });

    it("drops the drafts and brings the kept look back", async () => {
      discardMock.mockResolvedValue({ ok: true, value: studio });
      renderStudio(studio, BOT_ID);
      await click(screen.getByRole("button", { name: "Frog" }));
      expect(look()).toHaveAttribute("src", "https://blob/draft-frog.png");

      await click(screen.getByRole("button", { name: "cancel" }));

      expect(discardMock).toHaveBeenCalledWith({ botId: BOT_ID });
      expect(look()).toHaveAttribute("src", "https://blob/idle.png");
      expect(screen.getByRole("button", { name: "keep" })).toBeDisabled();
      expect(screen.queryByRole("button", { name: "cancel" })).toBeNull();
      expect(refreshMock).toHaveBeenCalled();
    });

    it("asks for the caller's own bot without a bot id", async () => {
      discardMock.mockResolvedValue({ ok: true, value: studio });
      renderStudio();
      await click(screen.getByRole("button", { name: "Frog" }));

      await click(screen.getByRole("button", { name: "cancel" }));

      expect(discardMock).toHaveBeenCalledWith({ botId: undefined });
    });

    it("clears the rewriter note", async () => {
      createMock.mockResolvedValue({
        ok: true,
        value: { draft: draft("frog"), note: "Left out the logo." },
      });
      discardMock.mockResolvedValue({ ok: true, value: studio });
      renderStudio();
      await click(screen.getByRole("button", { name: "Frog" }));
      expect(screen.getByText("Left out the logo.")).toBeInTheDocument();

      await click(screen.getByRole("button", { name: "cancel" }));

      expect(screen.queryByText("Left out the logo.")).toBeNull();
    });

    it("tells the person when it fails and keeps the draft", async () => {
      discardMock.mockResolvedValue({
        ok: false,
        error: { code: "INTERNAL", message: "boom" },
      });
      renderStudio();
      await click(screen.getByRole("button", { name: "Frog" }));

      await click(screen.getByRole("button", { name: "cancel" }));

      expect(toastErrorMock).toHaveBeenCalledWith("cancelError");
      expect(look()).toHaveAttribute("src", "https://blob/draft-frog.png");
      expect(screen.getByRole("button", { name: "keep" })).toBeEnabled();
    });
  });

  it("keeps a draft, says so, and refreshes the app", async () => {
    createMock.mockResolvedValue({
      ok: true,
      value: { draft: draft("frog"), note: "" },
    });
    keepMock.mockResolvedValue({
      ok: true,
      value: {
        ...studio,
        // A fresh keep: the look is the idle still and no state is rendered.
        avatar: {
          styleId: "crafted-desk",
          styleVersion: 1,
          stillUrl: "https://blob/draft-frog.png",
          states: NO_STATES,
        },
        progress: { ready: 0, failed: 0, total: 6 },
      },
    });
    renderStudio(studio, BOT_ID);
    await click(screen.getByRole("button", { name: "Frog" }));

    await click(screen.getByRole("button", { name: "keep" }));

    expect(keepMock).toHaveBeenCalledWith({ botId: BOT_ID, draftId: DRAFT_ID });
    expect(screen.getByText("saved")).toBeInTheDocument();
    expect(look()).toHaveAttribute("src", "https://blob/draft-frog.png");
    expect(screen.getByText("statesProgress(0,6)")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalled();
  });

  it("polls a kept look until its states are ready, then stops", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        studio: {
          avatar: studio.avatar,
          progress: { ready: 6, failed: 0, total: 6 },
        },
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderStudio(
      { ...studio, progress: { ready: 2, failed: 0, total: 6 } },
      BOT_ID,
    );
    expect(screen.getByText("statesProgress(2,6)")).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/personal-assistant/avatar?botId=${BOT_ID}`,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getByText("statesPlay")).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledOnce();

    await act(async () => {
      vi.advanceTimersByTime(20_000);
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("ignores a poll answer that is not the studio shape", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ studio: { progress: { ready: "six" } } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    renderStudio({ ...studio, progress: { ready: 2, failed: 0, total: 6 } });

    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(screen.getByText("statesProgress(2,6)")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("stops polling when the page goes away", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = renderStudio({
      ...studio,
      progress: { ready: 2, failed: 0, total: 6 },
    });

    unmount();
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says a legacy avatar animates once a new look is kept", () => {
    renderStudio({
      ...studio,
      avatar: {
        styleId: "mascot",
        styleVersion: 1,
        stillUrl: "https://blob/mascot.png",
        states: NO_STATES,
      },
      look: null,
      progress: { ready: 0, failed: 0, total: 0 },
    });
    expect(screen.getByText("statesDraft")).toBeInTheDocument();
    expect(look()).toHaveAttribute("src", "https://blob/mascot.png");
  });

  it("invites a first look when the bot has none", () => {
    renderStudio({
      ...studio,
      avatar: null,
      look: null,
      progress: { ready: 0, failed: 0, total: 0 },
    });
    expect(screen.getByText("empty")).toBeInTheDocument();
  });
});
