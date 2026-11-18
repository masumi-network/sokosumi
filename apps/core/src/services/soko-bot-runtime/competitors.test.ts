import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  projectFindFirst: vi.fn(),
  turnUpdate: vi.fn(),
  append: vi.fn(),
  findCusoForBot: vi.fn(),
  isCmoProject: vi.fn(),
  runCusoCompetitorCheck: vi.fn(),
  saveCusoCompetitorFeed: vi.fn(),
  runProjectCompetitorCheck: vi.fn(),
  readCompetitorSignals: vi.fn(),
  saveCompetitorFeed: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    project: { findFirst: m.projectFindFirst },
    sokoBotTurn: { update: m.turnUpdate },
  },
}));
vi.mock("@/lib/soko-bot/turn-loop", () => ({
  RuntimeEventLog: class {
    append = m.append;
  },
  runtimeEvent: (type: string, data: unknown) => ({ type, data }),
  WEB_TAINT_EVENT: "web_taint",
}));
vi.mock("@/services/cmo-competitors.service", () => ({
  runCusoCompetitorCheck: m.runCusoCompetitorCheck,
  saveCusoCompetitorFeed: m.saveCusoCompetitorFeed,
}));
vi.mock("@/services/cmo-cuso.service", () => ({
  findCusoForBot: m.findCusoForBot,
  isCmoProject: m.isCmoProject,
}));
vi.mock("@/services/competitor-check.service", () => ({
  runProjectCompetitorCheck: m.runProjectCompetitorCheck,
}));
vi.mock("@/services/competitor-feed.service", async (original) => ({
  ...(await original<typeof import("@/services/competitor-feed.service")>()),
  readCompetitorSignals: m.readCompetitorSignals,
  saveCompetitorFeed: m.saveCompetitorFeed,
}));
vi.mock("../soko-bot-runtime.service", () => ({
  SokoBotRuntimeAuthorizationError: class extends Error {},
  SokoBotRuntimeValidationError: class extends Error {},
}));

import { CompetitorFeedRefusedError } from "@/services/competitor-feed.service";

import type {
  AuthorizedSokoBotRuntime,
  ExecuteSokoBotToolInput,
} from "../soko-bot-runtime.service";
import { dispatchCompetitorTools } from "./competitors";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const SAVED = { saved: 1, bigMoves: [{ competitor: "Calendly", fact: "x" }] };

function authorized(projectId: string | null = null) {
  return {
    turn: { id: "turn-1", sokoBotId: "bot-1", workspaceId: "workspace-1" },
    reader: { sharedScope: projectId ? { projectId } : null },
  } as unknown as AuthorizedSokoBotRuntime;
}

function call(
  capability: "check_competitors" | "save_competitor_feed",
  input: object,
  bot = authorized(),
) {
  return dispatchCompetitorTools(
    { capability, input, sessionId: "session-1" } as ExecuteSokoBotToolInput,
    bot,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  m.findCusoForBot.mockResolvedValue(null);
  m.isCmoProject.mockResolvedValue(false);
  m.projectFindFirst.mockResolvedValue({ competitorChecksSince: new Date() });
  m.readCompetitorSignals.mockResolvedValue({ signals: [] });
  m.saveCompetitorFeed.mockResolvedValue({ ...SAVED, costUsd: 0.01 });
  m.saveCusoCompetitorFeed.mockResolvedValue({ ...SAVED, costUsd: 0 });
});

describe("competitor tools for any Soko Bot", () => {
  it("reads a named Project whose weekly check is on, and marks the turn as having read the web", async () => {
    await expect(
      call("check_competitors", { projectId: PROJECT }),
    ).resolves.toEqual({ signals: [] });
    expect(m.projectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PROJECT, workspaceId: "workspace-1", closedAt: null },
      }),
    );
    expect(m.runProjectCompetitorCheck).toHaveBeenCalledWith(
      PROJECT,
      expect.any(Date),
    );
    expect(m.append).toHaveBeenCalledTimes(1);
    expect(m.runCusoCompetitorCheck).not.toHaveBeenCalled();
  });

  it("saves the week without posting to a room, and bills Jev's reading to the turn", async () => {
    await expect(
      call("save_competitor_feed", { projectId: PROJECT, items: [] }),
    ).resolves.toEqual({ ...SAVED, postedToChat: false });
    expect(m.saveCompetitorFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        turnId: "turn-1",
        feed: { items: [], openQuestions: [] },
      }),
    );
    expect(m.turnUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { overheadCostUsdMicros: { increment: 10_000n } },
      }),
    );
  });

  it("uses a Project bot's own Project and refuses another", async () => {
    await call("check_competitors", {}, authorized(PROJECT));
    expect(m.readCompetitorSignals).toHaveBeenCalledWith(
      PROJECT,
      expect.any(Date),
    );
    await expect(
      call("check_competitors", { projectId: OTHER }, authorized(PROJECT)),
    ).rejects.toThrow("works only in its own Project");
  });

  it("asks a bot that works across Projects which one is meant", async () => {
    await expect(call("check_competitors", {})).rejects.toThrow(
      "Say which Project",
    );
  });

  it("refuses a Project of another workspace, and one whose check is off", async () => {
    m.projectFindFirst.mockResolvedValueOnce(null);
    await expect(
      call("check_competitors", { projectId: PROJECT }),
    ).rejects.toThrow("That Project was not found.");
    m.projectFindFirst.mockResolvedValueOnce({ competitorChecksSince: null });
    await expect(
      call("save_competitor_feed", { projectId: PROJECT, items: [] }),
    ).rejects.toThrow("The weekly competitor check is off for this Project.");
    expect(m.saveCompetitorFeed).not.toHaveBeenCalled();
  });

  it("reads a CMO Project and leaves its feed to CMO", async () => {
    m.isCmoProject.mockResolvedValue(true);
    m.projectFindFirst.mockResolvedValue({ competitorChecksSince: null });
    await expect(
      call("check_competitors", { projectId: PROJECT }),
    ).resolves.toEqual({ signals: [] });
    await expect(
      call("save_competitor_feed", { projectId: PROJECT, items: [] }),
    ).rejects.toThrow("CMO runs this Project");
    expect(m.saveCompetitorFeed).not.toHaveBeenCalled();
  });

  it("hands a refused save back to the bot with what to fix", async () => {
    m.saveCompetitorFeed.mockRejectedValue(
      new CompetitorFeedRefusedError(["Item 1 has a number its sources lack"]),
    );
    await expect(
      call("save_competitor_feed", { projectId: PROJECT, items: [] }),
    ).rejects.toThrow("Item 1 has a number its sources lack");
  });
});

describe("Cuso's competitor tools", () => {
  beforeEach(() => {
    m.findCusoForBot.mockResolvedValue({
      projectId: PROJECT,
      sokoBotId: "bot-1",
    });
  });

  it("stay on his own Project and on CMO's terms, whatever Project he names", async () => {
    await call("check_competitors", { projectId: OTHER });
    expect(m.runCusoCompetitorCheck).toHaveBeenCalled();
    expect(m.runProjectCompetitorCheck).not.toHaveBeenCalled();
    expect(m.readCompetitorSignals).toHaveBeenCalledWith(
      PROJECT,
      expect.any(Date),
    );
    expect(m.projectFindFirst).not.toHaveBeenCalled();
  });

  it("post his big moves to his room and say so", async () => {
    await expect(
      call("save_competitor_feed", { projectId: OTHER, items: [] }),
    ).resolves.toEqual({ ...SAVED, postedToChat: true });
    expect(m.saveCusoCompetitorFeed).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: PROJECT, sokoBotId: "bot-1" }),
    );
    expect(m.saveCompetitorFeed).not.toHaveBeenCalled();
  });
});
