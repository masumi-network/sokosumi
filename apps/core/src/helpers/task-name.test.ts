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

  it("keeps markdown a user typed into the name field", async () => {
    expect(
      await resolveTaskName({
        name: "# Keep this heading",
        description: "x",
      }),
    ).toBe("# Keep this heading");
    expect(generateTaskNameMock).not.toHaveBeenCalled();
  });

  it("generates from the description when no name is provided", async () => {
    generateTaskNameMock.mockResolvedValue("Generated name");
    expect(await resolveTaskName({ description: "Build landing page" })).toBe(
      "Generated name",
    );
    expect(generateTaskNameMock).toHaveBeenCalledWith("Build landing page");
  });

  it("stores a good generated name after cleanup", async () => {
    generateTaskNameMock.mockResolvedValue(
      '"Landing page competitor teardown."',
    );
    expect(
      await resolveTaskName({ description: "Teardown the homepage" }),
    ).toBe("Landing page competitor teardown");
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

  it("returns Untitled Task when the description is only attachment links", async () => {
    expect(
      await resolveTaskName({
        description: [
          "[DESIGN.md](https://blob.example/design.md)",
          "[BRIEFING.md](https://blob.example/projects/p1/BRIEFING.md)",
          "[CONTEXT.md](https://blob.example/projects/p1/CONTEXT.md)",
        ].join("\n"),
      }),
    ).toBe("Untitled Task");
    expect(generateTaskNameMock).not.toHaveBeenCalled();
  });

  it("falls back to the first non-empty line when generation returns null", async () => {
    generateTaskNameMock.mockResolvedValue(null);
    expect(await resolveTaskName({ description: "First line\nsecond" })).toBe(
      "First line",
    );
  });

  it("cleans a heading first line when generation is missing", async () => {
    generateTaskNameMock.mockResolvedValue(null);
    expect(
      await resolveTaskName({
        description: "# Marketing Deliverables: Current Market Rates\nBody",
      }),
    ).toBe("Marketing Deliverables: Current Market Rates");
  });

  it("returns 'Untitled Task' when there is no naming source", async () => {
    expect(await resolveTaskName({ description: "   " })).toBe("Untitled Task");
    expect(generateTaskNameMock).not.toHaveBeenCalled();
  });

  it("caps an auto-generated name at 60 characters", async () => {
    generateTaskNameMock.mockResolvedValue("B".repeat(200));
    expect(await resolveTaskName({ description: "x" })).toBe("B".repeat(60));
  });

  it("caps first-line fallback at 60 characters", async () => {
    generateTaskNameMock.mockResolvedValue(null);
    expect(await resolveTaskName({ description: "C".repeat(80) })).toBe(
      "C".repeat(60),
    );
  });

  it("rejects a heading dump and uses the cleaned first line", async () => {
    generateTaskNameMock.mockResolvedValue(
      "# Marketing Deliverables: Current Market Rates ## 1. LANDING PAGE BRIEF (Competitor Teardown + Structure + Copy Direction) ### Freelance Rates",
    );
    expect(
      await resolveTaskName({
        description:
          "# Marketing Deliverables: Current Market Rates\n## 1. LANDING PAGE BRIEF",
      }),
    ).toBe("Marketing Deliverables: Current Market Rates");
  });

  it("rejects refusal-like generated text and uses fallback", async () => {
    generateTaskNameMock.mockResolvedValue(
      "# Answer Engine Optimization Keyword Research Report ## Keyword Analysis Summary I need to be transparent: I cannot actually pull live keyword data",
    );
    expect(
      await resolveTaskName({
        description:
          "# Answer Engine Optimization Keyword Research Report\nI cannot actually pull live keyword data",
      }),
    ).toBe("Answer Engine Optimization Keyword Research Report");
  });

  it("rejects Unable to generated text and uses fallback", async () => {
    generateTaskNameMock.mockResolvedValue("Unable to summarize this brief");
    expect(
      await resolveTaskName({ description: "Write the pricing one-pager" }),
    ).toBe("Write the pricing one-pager");
  });

  it("rejects a concatenated numbered outline and uses fallback", async () => {
    generateTaskNameMock.mockResolvedValue(
      "1. LANDING PAGE BRIEF 2. Freelance Rates 3. Copy Direction",
    );
    expect(
      await resolveTaskName({
        description: "Landing page competitor teardown\n1. rates",
      }),
    ).toBe("Landing page competitor teardown");
  });

  it("rejects a numbered outline concatenated after a label", async () => {
    generateTaskNameMock.mockResolvedValue(
      "Marketing Deliverables: Current Market Rates 1. LANDING PAGE BRIEF 2. Freelance Rates",
    );
    expect(
      await resolveTaskName({
        description: "Landing page competitor teardown",
      }),
    ).toBe("Landing page competitor teardown");
  });

  it("uses fallback when generation is empty or whitespace", async () => {
    generateTaskNameMock.mockResolvedValue("   ");
    expect(
      await resolveTaskName({ description: "Ship the onboarding checklist" }),
    ).toBe("Ship the onboarding checklist");
  });

  it("strips HTML, markdown tokens, and wrapping quotes from auto-names", async () => {
    generateTaskNameMock.mockResolvedValue("<b>Launch</b> `plan` *draft*");
    expect(await resolveTaskName({ description: "Launch plan" })).toBe(
      "Launch plan draft",
    );
  });

  it("keeps emoji in a short clean generated name", async () => {
    generateTaskNameMock.mockResolvedValue("🚀 Launch campaign");
    expect(await resolveTaskName({ description: "Launch the campaign" })).toBe(
      "🚀 Launch campaign",
    );
  });

  it("omits fence markers when the description starts with a code fence", async () => {
    generateTaskNameMock.mockResolvedValue(null);
    expect(
      await resolveTaskName({
        description: "```markdown\n# Notes\n```\nWrite the launch email",
      }),
    ).toBe("Write the launch email");
  });
});
