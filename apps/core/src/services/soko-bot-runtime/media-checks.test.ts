import { beforeEach, describe, expect, it, vi } from "vitest";

const { countMock, requireProjectAccessMock } = vi.hoisted(() => ({
  countMock: vi.fn(),
  requireProjectAccessMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotToolCall: { count: countMock } },
}));
vi.mock("@/lib/image-studio/access", () => ({
  requireProjectAccess: requireProjectAccessMock,
}));

import { checkTalkingVideoRequest } from "./media-checks";
import type { RuntimeOperations } from "./operations";

const runtime = {
  mayActForOwner: vi.fn(),
  refuseCmoRunMedia: vi.fn(),
  mediaPerTurn: vi.fn(),
  requireImageProject: vi.fn(),
} as unknown as RuntimeOperations;

const authorized = {
  turn: { id: "turn-1", workspaceId: "workspace-1", userId: "user-1" },
} as unknown as Parameters<typeof checkTalkingVideoRequest>[1];

const SCRIPT =
  "Your inbox is not a to-do list. Soko Bot reads every mail and leaves only what matters unread. Try it this week.";

function request(input: Record<string, unknown> = {}) {
  return checkTalkingVideoRequest(
    runtime,
    authorized,
    {
      projectId: "project-1",
      script: SCRIPT,
      presenter: "maya",
      maxCredits: 250,
      ...input,
    },
    "call-1",
  );
}

beforeEach(() => {
  vi.mocked(runtime.mayActForOwner).mockResolvedValue(true);
  vi.mocked(runtime.mediaPerTurn).mockResolvedValue({ images: 4, videos: 2 });
  countMock.mockResolvedValue(0);
  requireProjectAccessMock.mockResolvedValue({ organizationId: null });
});

describe("checkTalkingVideoRequest", () => {
  it("quotes the script on the talking video model", async () => {
    const { credits, model } = await request();

    expect(model.id).toBe("avatar-6-turbo");
    // 112 characters is about 9 s: $1.629 of video, plus voice and captions.
    expect(credits).toBe(165);
  });

  it("refuses an unknown presenter", async () => {
    await expect(request({ presenter: "patrick" })).rejects.toThrow(
      "presenter must be one of",
    );
  });

  it("refuses a script that speaks as a customer", async () => {
    await expect(
      request({
        script: "I've been using Soko Bot for a month and it changed my life.",
      }),
    ).rejects.toThrow("cannot speak as a customer");
  });

  it("refuses a price above maxCredits", async () => {
    await expect(request({ maxCredits: 100 })).rejects.toThrow(
      "more than the 100 allowed",
    );
  });

  it("counts talking videos against the turn's video allowance", async () => {
    countMock.mockResolvedValue(2);

    await expect(request()).rejects.toThrow("at most 2 videos");
    expect(countMock.mock.calls[0]![0].where.capability).toEqual({
      in: ["generate_video", "generate_talking_video"],
    });
  });

  it("refuses outside an owner's chat", async () => {
    vi.mocked(runtime.mayActForOwner).mockResolvedValue(false);

    await expect(request()).rejects.toThrow("only when a person asks");
  });
});
