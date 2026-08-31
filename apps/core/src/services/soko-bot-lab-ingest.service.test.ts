import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  botFindFirstMock,
  activeIntegrationsMock,
  startTurnMock,
  activeTurnMock,
  deltaMessageMock,
  beatMessageMock,
} = vi.hoisted(() => ({
  botFindFirstMock: vi.fn(),
  activeIntegrationsMock: vi.fn(),
  startTurnMock: vi.fn(),
  activeTurnMock: vi.fn(),
  deltaMessageMock: vi.fn(),
  beatMessageMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBot: { findFirst: botFindFirstMock },
    sokoBotTurn: { findFirst: activeTurnMock },
  },
}));
vi.mock("@/services/soko-bot-integrations.service", () => ({
  activeIntegrationsForBot: activeIntegrationsMock,
}));
vi.mock("@/services/soko-bot-control-plane.service", () => ({
  ACTIVE_TURN_STATUSES: ["STARTING", "RUNNING"],
  sokoBotControlPlane: { startTurn: startTurnMock },
}));
vi.mock("@/services/soko-bot-ingest.service", () => ({
  buildIngestDeltaMessageForBot: deltaMessageMock,
}));
vi.mock("@/services/soko-bot-proactive.service", () => ({
  buildSystemBeatMessage: beatMessageMock,
}));

import {
  runSokoBotLabIngest,
  SokoBotLabBusyError,
  SokoBotLabMissingIntegrationError,
} from "@/services/soko-bot-lab-ingest.service";

const SCOPE = { userId: "user_1", workspaceId: "ws_1" };

describe("runSokoBotLabIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    botFindFirstMock.mockResolvedValue({
      id: "bot_1",
      workspaceId: "ws_1",
      ingestTimezone: "Europe/Zurich",
      followWholeBoard: true,
      coworker: { id: "cow_1" },
    });
    activeIntegrationsMock.mockResolvedValue([{ id: "int_1" }]);
    activeTurnMock.mockResolvedValue(null);
    deltaMessageMock.mockResolvedValue("## Unread mail");
    beatMessageMock.mockResolvedValue({ message: "Daily stand-up." });
    startTurnMock.mockResolvedValue({ turnId: "turn_1" });
  });

  it("names what to connect instead of sending anyone to a terminal", async () => {
    // The scenario is runnable; the owner just has to link the account it
    // reads from. That is a different thing from "not supported here".
    activeIntegrationsMock.mockResolvedValue([]);

    await expect(
      runSokoBotLabIngest({ ...SCOPE, beat: "delta" }),
    ).rejects.toBeInstanceOf(SokoBotLabMissingIntegrationError);
    expect(startTurnMock).not.toHaveBeenCalled();
  });

  it("runs the weekly wrap with nothing connected", async () => {
    // It is built from the board and the bot's memory, so requiring an inbox
    // for it was the reason two scenarios were unreachable for no reason.
    activeIntegrationsMock.mockResolvedValue([]);

    const result = await runSokoBotLabIngest({
      ...SCOPE,
      beat: "weekly-wrap",
    });

    expect(result.turnId).toBe("turn_1");
  });

  it("uses the source the cron would have used", async () => {
    // The route decides which capabilities the turn is scoped to, so a lab
    // run only means anything if it is classified the same way.
    await runSokoBotLabIngest({ ...SCOPE, beat: "delta" });
    expect(startTurnMock.mock.calls[0]![0].source).toBe("INGEST");

    startTurnMock.mockClear();
    await runSokoBotLabIngest({ ...SCOPE, beat: "standup" });
    expect(startTurnMock.mock.calls[0]![0].source).toBe("SCHEDULE");
  });

  it("runs the stand-up on a calendar alone", async () => {
    // The builder treats both accounts as optional and still writes a brief
    // from the board and memory, so demanding both would refuse a run the
    // real schedule would have made.
    activeIntegrationsMock.mockImplementation(
      async (_id: string, kind: string) =>
        kind === "calendar" ? [{ id: "int_1" }] : [],
    );

    await expect(
      runSokoBotLabIngest({ ...SCOPE, beat: "standup" }),
    ).resolves.toEqual({ turnId: "turn_1" });
  });

  it("refuses before reading anything when the bot is mid-turn", async () => {
    // The stand-up makes up to four sequential Composio calls; finding out
    // afterwards means having made all of them for nothing.
    activeTurnMock.mockResolvedValue({ id: "turn_busy" });

    await expect(
      runSokoBotLabIngest({ ...SCOPE, beat: "standup" }),
    ).rejects.toBeInstanceOf(SokoBotLabBusyError);
    expect(activeIntegrationsMock).not.toHaveBeenCalled();
  });

  it("keeps the run out of the owner's proactive allowance", async () => {
    await runSokoBotLabIngest({ ...SCOPE, beat: "delta" });

    expect(startTurnMock.mock.calls[0]![0].clientTurnId).toMatch(/^lab:/);
  });
});
