import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { labRunFindManyMock, turnFindManyMock } = vi.hoisted(() => ({
  labRunFindManyMock: vi.fn(),
  turnFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotLabRun: { findMany: labRunFindManyMock },
    sokoBotTurn: { findMany: turnFindManyMock },
  },
}));

import { getSokoBotQualityOverview } from "@/services/soko-bot-quality.service";

function turn(overrides: Record<string, unknown>) {
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
    labRunFindManyMock.mockResolvedValue([]);
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

    expect(quality.daily.find((day) => day.date === "2026-08-26")).toMatchObject(
      {
        thumbsUp: 1,
        thumbsDown: 0,
      },
    );
    expect(quality.daily.find((day) => day.date === "2026-08-27")).toMatchObject(
      {
        thumbsUp: 0,
        thumbsDown: 1,
      },
    );
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
    expect(quality.daily.find((day) => day.date === "2026-08-27")).toMatchObject(
      {
        turns: 1,
        avgScore: 2,
        thumbsDown: 0,
      },
    );
    expect(
      quality.versions.find((version) => version.versionId === "test-v2"),
    ).toMatchObject({ turns: 1, avgScore: 1 });
  });
});
