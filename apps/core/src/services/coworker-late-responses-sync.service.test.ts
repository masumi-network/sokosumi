import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  listMock,
  untrackMock,
  retrieveMock,
  persistMock,
  clearMirrorMock,
  coworkerFindUniqueMock,
} = vi.hoisted(() => ({
  listMock: vi.fn(),
  untrackMock: vi.fn(),
  retrieveMock: vi.fn(),
  persistMock: vi.fn(),
  clearMirrorMock: vi.fn(),
  coworkerFindUniqueMock: vi.fn(),
}));

vi.mock("@/helpers/coworker-late-responses", () => ({
  listLateCoworkerResponses: listMock,
  untrackLateCoworkerResponse: untrackMock,
}));
vi.mock("@/helpers/coworker-response-poll", () => ({
  retrieveCoworkerResponse: retrieveMock,
}));
vi.mock("@/helpers/persist-assistant-to-chat-room", () => ({
  persistAssistantToChatRoom: persistMock,
}));
vi.mock("@/helpers/coworker-pending-response-mirror", () => ({
  clearPendingResponseMirror: clearMirrorMock,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { coworker: { findUnique: coworkerFindUniqueMock } },
}));

import {
  LATE_RESPONSE_GRACE_MS,
  LATE_RESPONSE_MAX_AGE_MS,
  LATE_RESPONSE_MISSING_TEXT,
  LATE_RESPONSES_PER_RUN,
  syncLateCoworkerResponses,
} from "./coworker-late-responses-sync.service";

const NOW = 10_000_000;
function entry(responseId: string, ageMs: number) {
  return {
    responseId,
    roomId: "room_1",
    parentMessageId: null,
    coworkerId: "cw_1",
    userId: "user_1",
    organizationId: "org_1",
    startedAtMs: NOW - ageMs,
  };
}
const sync = () =>
  syncLateCoworkerResponses({ shouldContinue: () => true, now: () => NOW });

describe("syncLateCoworkerResponses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coworkerFindUniqueMock.mockResolvedValue({
      slug: "codepat",
      baseURL: "https://codepat.example.com/v1",
    });
  });

  it("leaves responses to their live stream inside the grace window", async () => {
    listMock.mockResolvedValue([
      entry("resp_live", LATE_RESPONSE_GRACE_MS - 1),
    ]);

    expect(await sync()).toEqual({ delivered: 0, dropped: 0, waiting: 1 });
    expect(retrieveMock).not.toHaveBeenCalled();
    expect(untrackMock).not.toHaveBeenCalled();
  });

  it("posts a reply that finished after the stream ended", async () => {
    listMock.mockResolvedValue([
      entry("resp_late", LATE_RESPONSE_GRACE_MS + 1),
    ]);
    retrieveMock.mockResolvedValue({
      result: { status: "completed", responseId: "resp_late" },
      text: "PR merged.",
    });

    expect(await sync()).toEqual({ delivered: 1, dropped: 0, waiting: 0 });
    expect(retrieveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        responsesApiBaseUrl: "https://codepat.example.com/v1",
        responseId: "resp_late",
        coworkerSlug: "codepat",
        userId: "user_1",
        organizationId: "org_1",
      }),
    );
    expect(persistMock).toHaveBeenCalledWith({
      roomId: "room_1",
      senderCoworkerId: "cw_1",
      contentText: "PR merged.",
      responsesApiResponseId: "resp_late",
      parentMessageId: null,
    });
    expect(clearMirrorMock).toHaveBeenCalledWith({
      roomId: "room_1",
      parentMessageId: null,
    });
    expect(untrackMock).toHaveBeenCalledWith("resp_late");
  });

  it("keeps waiting while the coworker is still working or unreachable", async () => {
    listMock.mockResolvedValue([
      entry("resp_busy", LATE_RESPONSE_GRACE_MS + 1),
      entry("resp_down", LATE_RESPONSE_GRACE_MS + 1),
    ]);
    retrieveMock
      .mockResolvedValueOnce({
        result: { status: "in_progress", responseId: "resp_busy" },
        text: null,
      })
      .mockResolvedValueOnce({
        result: {
          status: "error",
          responseId: "resp_down",
          cause: new Error("x"),
        },
        text: null,
      });

    expect(await sync()).toEqual({ delivered: 0, dropped: 0, waiting: 2 });
    expect(untrackMock).not.toHaveBeenCalled();
    expect(persistMock).not.toHaveBeenCalled();
  });

  it("gives up on failed, empty and expired responses with a note, but keeps retrying a 404", async () => {
    listMock.mockResolvedValue([
      entry("resp_failed", LATE_RESPONSE_GRACE_MS + 1),
      entry("resp_empty", LATE_RESPONSE_GRACE_MS + 1),
      entry("resp_unknown", LATE_RESPONSE_GRACE_MS + 1),
      entry("resp_old", LATE_RESPONSE_MAX_AGE_MS + 1),
    ]);
    retrieveMock.mockImplementation(async ({ responseId }) => {
      if (responseId === "resp_failed")
        return { result: { status: "failed", responseId }, text: null };
      if (responseId === "resp_empty")
        return { result: { status: "completed", responseId }, text: null };
      return {
        result: {
          status: "error",
          responseId,
          cause: new Error("x"),
          httpStatus: 404,
        },
        text: null,
      };
    });

    expect(await sync()).toEqual({ delivered: 0, dropped: 3, waiting: 1 });
    expect(retrieveMock).toHaveBeenCalledTimes(3);
    expect(untrackMock).toHaveBeenCalledTimes(3);
    expect(untrackMock).not.toHaveBeenCalledWith("resp_unknown");
    expect(persistMock).toHaveBeenCalledTimes(3);
    expect(persistMock).toHaveBeenCalledWith({
      roomId: "room_1",
      senderCoworkerId: "cw_1",
      contentText: LATE_RESPONSE_MISSING_TEXT,
      responsesApiResponseId: "resp_old",
      parentMessageId: null,
    });
  });

  it("drops an entry without a note when its coworker is gone", async () => {
    listMock.mockResolvedValue([
      entry("resp_orphan", LATE_RESPONSE_GRACE_MS + 1),
    ]);
    coworkerFindUniqueMock.mockResolvedValue(null);

    expect(await sync()).toEqual({ delivered: 0, dropped: 1, waiting: 0 });
    expect(persistMock).not.toHaveBeenCalled();
    expect(untrackMock).toHaveBeenCalledWith("resp_orphan");
  });

  it("handles the oldest responses first and bounds each run", async () => {
    const entries = Array.from({ length: LATE_RESPONSES_PER_RUN + 2 }, (_, i) =>
      entry(`resp_${i}`, LATE_RESPONSE_GRACE_MS + 1 + i),
    );
    listMock.mockResolvedValue(entries);
    retrieveMock.mockImplementation(async ({ responseId }) => ({
      result: { status: "in_progress", responseId },
      text: null,
    }));

    expect(await sync()).toEqual({
      delivered: 0,
      dropped: 0,
      waiting: LATE_RESPONSES_PER_RUN + 2,
    });
    expect(retrieveMock).toHaveBeenCalledTimes(LATE_RESPONSES_PER_RUN);
    expect(retrieveMock.mock.calls[0][0].responseId).toBe(
      `resp_${LATE_RESPONSES_PER_RUN + 1}`,
    );
  });

  it("removes an expired entry even when its note cannot be saved", async () => {
    listMock.mockResolvedValue([
      entry("resp_old", LATE_RESPONSE_MAX_AGE_MS + 1),
    ]);
    persistMock.mockRejectedValueOnce(new Error("coworker deleted"));

    expect(await sync()).toEqual({ delivered: 0, dropped: 1, waiting: 0 });
    expect(untrackMock).toHaveBeenCalledWith("resp_old");
  });

  it("retries later when saving the reply fails", async () => {
    listMock.mockResolvedValue([
      entry("resp_late", LATE_RESPONSE_GRACE_MS + 1),
    ]);
    retrieveMock.mockResolvedValue({
      result: { status: "completed", responseId: "resp_late" },
      text: "Done.",
    });
    persistMock.mockRejectedValueOnce(new Error("db down"));

    expect(await sync()).toEqual({ delivered: 0, dropped: 0, waiting: 1 });
    expect(untrackMock).not.toHaveBeenCalled();
  });
});
