import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/evals/eval-guard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/evals/eval-guard")>()),
  isEvalWorkspace: vi.fn().mockResolvedValue(true),
  evalCoworkerRefusal: vi.fn().mockResolvedValue(null),
}));

import { SokoBotRefusedUnsentError } from "../soko-bot-runtime.service";
import { executeAuthorizedTool } from "./dispatch";

describe("paid media in a benchmark lane", () => {
  it.each(["generate_talking_video", "generate_voiceover"])(
    "refuses %s unsent: no job, no queued receipt",
    async (capability) => {
      const runtime = {
        authorize: vi.fn().mockResolvedValue({
          turn: { id: "turn-1", workspaceId: "lane-1" },
        }),
        resolveTaskIds: vi.fn(async (_authorized, input) => input),
        generateTalkingVideo: vi.fn(),
        generateVoiceover: vi.fn(),
      };
      await expect(
        executeAuthorizedTool(
          runtime as never,
          {
            capability,
            input: {},
          } as never,
        ),
      ).rejects.toBeInstanceOf(SokoBotRefusedUnsentError);
      expect(runtime.generateTalkingVideo).not.toHaveBeenCalled();
      expect(runtime.generateVoiceover).not.toHaveBeenCalled();
    },
  );
});
