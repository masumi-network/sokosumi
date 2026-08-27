import type { SokoBotTurnSource } from "@sokosumi/database";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { turnFindManyMock } = vi.hoisted(() => ({
  turnFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findMany: turnFindManyMock },
  },
}));

import { getSokoBotQualityOverview } from "@/services/soko-bot-quality.service";

interface QualityTurn {
  createdAt: Date;
  finalAnswer: string | null;
  ownerFeedback: number | null;
  ownerFeedbackAt: Date | null;
  qualityScore: number | null;
  sokoBotId: string;
  source: SokoBotTurnSource;
  versionId: string | null;
}

function turn(overrides: Partial<QualityTurn>): QualityTurn {
  return {
    createdAt: new Date("2026-08-25T09:00:00.000Z"),
    finalAnswer: "I completed the requested work.",
    ownerFeedback: null,
    ownerFeedbackAt: null,
    qualityScore: 4,
    sokoBotId: "bot-1",
    source: "SCHEDULE",
    versionId: "test-v1",
    ...overrides,
  };
}

describe("getSokoBotQualityOverview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("groups distinct owner feedback counts by the day the feedback was given", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        ownerFeedback: 1,
        ownerFeedbackAt: new Date("2026-08-26T08:00:00.000Z"),
      }),
      turn({
        createdAt: new Date("2026-08-26T10:00:00.000Z"),
        ownerFeedback: -1,
        ownerFeedbackAt: new Date("2026-08-27T08:00:00.000Z"),
      }),
    ]);

    const quality = await getSokoBotQualityOverview();

    expect(
      quality.daily.find((day) => day.date === "2026-08-26"),
    ).toMatchObject({
      thumbsUp: 1,
      thumbsDown: 0,
    });
    expect(
      quality.daily.find((day) => day.date === "2026-08-27"),
    ).toMatchObject({
      thumbsUp: 0,
      thumbsDown: 1,
    });
  });

  it("queries only real turns", async () => {
    turnFindManyMock.mockResolvedValue([]);

    await getSokoBotQualityOverview();

    expect(turnFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          NOT: { clientTurnId: { startsWith: "lab:" } },
        }),
      }),
    );
  });

  it("includes recent feedback from older turns without changing headline turn counts", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        createdAt: new Date("2026-07-01T09:00:00.000Z"),
        ownerFeedback: -1,
        ownerFeedbackAt: new Date("2026-08-27T08:00:00.000Z"),
      }),
    ]);

    const quality = await getSokoBotQualityOverview();

    expect(turnFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { createdAt: { gte: new Date("2026-07-28T12:00:00.000Z") } },
            {
              ownerFeedbackAt: {
                gte: new Date("2026-07-28T12:00:00.000Z"),
              },
            },
          ],
        }),
      }),
    );
    expect(quality.overall.turns).toBe(0);
    expect(
      quality.daily.find((day) => day.date === "2026-08-27"),
    ).toMatchObject({ thumbsDown: 1 });
  });

  it("scopes panel metrics to one version while preserving fleet version rows", async () => {
    turnFindManyMock.mockResolvedValue([
      turn({
        ownerFeedback: 1,
        ownerFeedbackAt: new Date("2026-08-26T08:00:00.000Z"),
        qualityScore: 4,
      }),
      turn({
        createdAt: new Date("2026-08-27T08:00:00.000Z"),
        finalAnswer: "Thanks",
        qualityScore: 2,
        source: "CHAT",
      }),
      turn({
        createdAt: new Date("2026-08-27T09:00:00.000Z"),
        ownerFeedback: -1,
        ownerFeedbackAt: new Date("2026-08-27T10:00:00.000Z"),
        qualityScore: 1,
        versionId: "test-v2",
      }),
    ]);

    const quality = await getSokoBotQualityOverview({
      versionId: "test-v1",
    });

    expect(quality.overall).toEqual({ turns: 2, judged: 2, avgScore: 3 });
    expect(quality.proactive).toMatchObject({
      sent: 1,
      thumbsUp: 1,
      thumbsDown: 0,
    });
    expect(
      quality.daily.find((day) => day.date === "2026-08-27"),
    ).toMatchObject({
      turns: 1,
      avgScore: 2,
      thumbsDown: 0,
    });
    expect(
      quality.versions.find((version) => version.versionId === "test-v2"),
    ).toMatchObject({ turns: 1, avgScore: 1 });
  });

  it("returns empty metrics for a requested version without recent turns", async () => {
    turnFindManyMock.mockResolvedValue([turn({ versionId: "test-v1" })]);

    const quality = await getSokoBotQualityOverview({
      versionId: "new-authored-version",
    });

    expect(quality.overall).toEqual({ turns: 0, judged: 0, avgScore: null });
    expect(quality.proactive).toMatchObject({
      sent: 0,
      actedOn: 0,
      thumbsUp: 0,
      thumbsDown: 0,
    });
    expect(quality.daily.every((day) => day.turns === 0)).toBe(true);
  });
});
