import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getProjectByIdMock = vi.fn();

vi.mock("@/lib/services/project.service", () => ({
  projectService: {
    getProjectById: (...args: unknown[]) => getProjectByIdMock(...args),
  },
}));

describe("projectFilesService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves BRIEFING.md and CONTEXT.md attachments from a project", async () => {
    getProjectByIdMock.mockResolvedValue({
      briefingUrl: "https://blob.example/BRIEFING.md",
      contextMd: {
        url: "https://blob.example/CONTEXT.md",
      },
    });

    const { projectFilesService } = await import("../project-files.service");
    const result =
      await projectFilesService.resolveProjectAttachments("project-1");

    expect(getProjectByIdMock).toHaveBeenCalledWith("project-1");
    expect(result).toEqual({
      briefing: {
        label: "BRIEFING.md",
        url: "https://blob.example/BRIEFING.md",
      },
      contextMd: {
        label: "CONTEXT.md",
        url: "https://blob.example/CONTEXT.md",
      },
    });
  });

  it("returns null for unavailable project files", async () => {
    getProjectByIdMock.mockResolvedValue({
      briefingUrl: null,
      contextMd: null,
    });

    const { projectFilesService } = await import("../project-files.service");

    await expect(
      projectFilesService.resolveProjectAttachments("project-1"),
    ).resolves.toEqual({ briefing: null, contextMd: null });
  });

  it("prepends available project files once in stable order", async () => {
    getProjectByIdMock.mockResolvedValue({
      briefingUrl: "https://blob.example/BRIEFING.md",
      contextMd: {
        url: "https://blob.example/CONTEXT.md",
      },
    });

    const { projectFilesService } = await import("../project-files.service");
    const first = await projectFilesService.appendProjectFilesToDescription(
      "Write campaign plan",
      "project-1",
    );
    const second = await projectFilesService.appendProjectFilesToDescription(
      first,
      "project-1",
    );

    expect(first).toBe(
      "[BRIEFING.md](https://blob.example/BRIEFING.md)\n\n" +
        "[CONTEXT.md](https://blob.example/CONTEXT.md)\n\n" +
        "Write campaign plan",
    );
    expect(second).toBe(first);
  });

  it("honors per-file skip options and avoids lookup when both are skipped", async () => {
    getProjectByIdMock.mockResolvedValue({
      briefingUrl: "https://blob.example/BRIEFING.md",
      contextMd: {
        url: "https://blob.example/CONTEXT.md",
      },
    });

    const { projectFilesService } = await import("../project-files.service");
    const contextOnly =
      await projectFilesService.appendProjectFilesToDescription(
        "Write campaign plan",
        "project-1",
        { skipBriefing: true },
      );

    expect(contextOnly).toBe(
      "[CONTEXT.md](https://blob.example/CONTEXT.md)\n\nWrite campaign plan",
    );

    getProjectByIdMock.mockClear();
    await expect(
      projectFilesService.appendProjectFilesToDescription(
        "Write campaign plan",
        "project-1",
        { skipBriefing: true, skipContextMd: true },
      ),
    ).resolves.toBe("Write campaign plan");
    expect(getProjectByIdMock).not.toHaveBeenCalled();
  });
});
