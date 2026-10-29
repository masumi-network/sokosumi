import type {
  SokoBotAvatarDraft,
  SokoBotAvatarStudio,
} from "@sokosumi/core-client";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createMock, keepMock, refreshMock, toastErrorMock } = vi.hoisted(
  () => ({
    createMock: vi.fn(),
    keepMock: vi.fn(),
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
);

vi.mock("motion/react", () => ({ useReducedMotion: () => false }));

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
    loopUrl: `https://blob/${name}-320.webp`,
    loopLargeUrl: `https://blob/${name}-560.webp`,
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

  it("plays a picked state once, then rests on its still", async () => {
    renderStudio();

    await click(screen.getByRole("button", { name: "label.working" }));
    expect(look()).toHaveAttribute("src", "https://blob/working-560.webp");

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(look()).toHaveAttribute("src", "https://blob/working.png");
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
});
