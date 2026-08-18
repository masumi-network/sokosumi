import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateTaskNameMock } = vi.hoisted(() => ({
  generateTaskNameMock: vi.fn(),
}));

vi.mock("@/clients/openrouter.client", () => ({
  openrouterClient: { generateTaskName: generateTaskNameMock },
}));

import { resolveTaskName } from "./task-name";

describe("resolveTaskName", () => {
  beforeEach(() => {
    generateTaskNameMock.mockReset();
  });

  it("uses a provided name verbatim (trimmed) and skips the LLM", async () => {
    expect(await resolveTaskName({ name: "  Hello  ", description: "x" })).toBe(
      "Hello",
    );
    expect(generateTaskNameMock).not.toHaveBeenCalled();
  });

  it("preserves a provided name longer than 120 characters", async () => {
    const long = "A".repeat(200);
    expect(await resolveTaskName({ name: long, description: null })).toBe(long);
  });

  it("generates from the description when no name is provided", async () => {
    generateTaskNameMock.mockResolvedValue("Generated name");
    expect(await resolveTaskName({ description: "Build landing page" })).toBe(
      "Generated name",
    );
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
  });

  it("strips DESIGN.md links before naming", async () => {
    generateTaskNameMock.mockResolvedValue("Generated name");
    await resolveTaskName({
      description:
        "[DESIGN.md](https://blob.example/design.md)\n\nBuild landing page",
    });
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
  });

  it("strips BRIEFING.md and CONTEXT.md project links before naming", async () => {
    generateTaskNameMock.mockResolvedValue(null);
    expect(
      await resolveTaskName({
        description: [
          "[BRIEFING.md](https://blob.example/projects/p1/BRIEFING.md)",
          "",
          "[CONTEXT.md](https://blob.example/projects/p1/CONTEXT.md)",
          "",
          "Draft the LinkedIn launch post",
        ].join("\n"),
      }),
    ).toBe("Draft the LinkedIn launch post");
  });

  it("falls back to the first non-empty line when generation returns null", async () => {
    generateTaskNameMock.mockResolvedValue(null);
    expect(await resolveTaskName({ description: "First line\nsecond" })).toBe(
      "First line",
    );
  });

  it("returns 'Untitled Task' when there is no naming source", async () => {
    expect(await resolveTaskName({ description: "   " })).toBe("Untitled Task");
    expect(generateTaskNameMock).not.toHaveBeenCalled();
  });

  it("preserves a generated name longer than 120 characters", async () => {
    generateTaskNameMock.mockResolvedValue("B".repeat(200));
    expect(await resolveTaskName({ description: "x" })).toBe("B".repeat(200));
  });
});
