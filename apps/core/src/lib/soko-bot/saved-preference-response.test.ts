import {
  createEmptySokoBotMemory,
  parseSokoBotMemory,
  renderSokoBotMemory,
  SOKO_BOT_MEMORY_LIMITS,
} from "@sokosumi/soko-bot";
import { describe, expect, it, vi } from "vitest";
import prisma from "@/lib/db/prisma";
import { sanitizeMemory } from "./context-packet-format";
import { savedPreferenceResponse } from "./saved-preference-response";

vi.mock("@/lib/db/prisma", () => ({
  default: { sokoBotMemoryRevision: { findFirst: vi.fn() } },
}));

describe("committed preference proof", () => {
  it("keeps a valid capture confirmation when context truncation omits preferences", async () => {
    const instruction = "Write Hannah's Task briefs in German.";
    const memory = createEmptySokoBotMemory();
    for (const section of ["activeGoals", "decisions"] as const) {
      memory[section] = Array.from(
        { length: SOKO_BOT_MEMORY_LIMITS.maxEntriesPerSection },
        (_, index) => `${section} ${index}: ${"x".repeat(470)}`,
      );
    }
    memory.preferences.push(instruction);
    const markdown = renderSokoBotMemory(memory);
    expect(Buffer.byteLength(markdown)).toBeLessThan(
      SOKO_BOT_MEMORY_LIMITS.maxBytes,
    );
    const clipped = sanitizeMemory(markdown);
    expect(parseSokoBotMemory(clipped).preferences).not.toContain(instruction);
    vi.mocked(prisma.sokoBotMemoryRevision.findFirst).mockResolvedValueOnce({
      markdown,
    } as never);
    expect(
      await savedPreferenceResponse(prisma, {
        source: "CHAT",
        sokoBotId: "bot-1",
        contextSnapshot: {
          packet: {
            trigger: {
              source: "CHAT",
              askedBy: { kind: "OWNER" },
              savedPreference: {
                instruction,
                memoryRevisionId: "11111111-1111-4111-8111-111111111111",
                memoryVersion: 2,
                memoryHash: "capture-hash",
              },
            },
            memory: {
              version: 2,
              hash: "clipped-context-hash",
              markdown: clipped,
            },
          },
        },
      }),
    ).toBe(`Saved preference: ${JSON.stringify(instruction)}.`);
  });
});
