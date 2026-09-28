import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { hasCurrentUserSocialBetaAccessMock, projectServiceMock, notFoundMock } =
  vi.hoisted(() => ({
    hasCurrentUserSocialBetaAccessMock: vi.fn(),
    projectServiceMock: {
      getProjectById: vi.fn(),
      getProjectContextMd: vi.fn(),
    },
    notFoundMock: vi.fn(() => {
      throw new Error("NOT_FOUND");
    }),
  }));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
  usePathname: () => "/projects/project-1/memory",
}));

vi.mock("next-intl/server", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    getFormatter: async () => createTestFormatter(),
    getTranslations: async (namespace: string) => (key: string) =>
      `${namespace}.${key}`,
  };
});

vi.mock("@/lib/social-beta-access.server", () => ({
  hasCurrentUserSocialBetaAccess: () => hasCurrentUserSocialBetaAccessMock(),
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/app/projects/components/project-memory-panel", () => ({
  ProjectMemoryPanel: (props: {
    content: string | null;
    contextMd: { version: number } | null;
    contextMdUpdating: boolean;
    memoryEnabled?: boolean;
  }) => (
    <div
      data-testid="memory-panel"
      data-content={props.content ?? ""}
      data-enabled={String(props.memoryEnabled)}
      data-updating={String(props.contextMdUpdating)}
      data-version={props.contextMd ? String(props.contextMd.version) : ""}
    />
  ),
}));

const CONTEXT_MD = {
  url: "https://blob.example/projects/project-1/CONTEXT.md",
  updatedAt: new Date("2026-09-20T10:00:00.000Z"),
  version: 47,
  model: {
    id: "mistral/mistral-medium-latest",
    label: "Mistral Medium",
    region: "eu",
  },
  lineCount: 42,
};

function buildProject(overrides: Record<string, unknown> = {}) {
  return {
    id: "project-1",
    name: "Launch plan",
    logo: null,
    websiteUrl: null,
    memoryEnabled: true,
    memoryModel: CONTEXT_MD.model,
    contextMd: CONTEXT_MD,
    contextMdUpdating: false,
    createdAt: new Date("2026-05-27T10:00:00.000Z"),
    updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    ...overrides,
  };
}

describe("ProjectMemoryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasCurrentUserSocialBetaAccessMock.mockResolvedValue(false);
  });

  it("calls notFound when the project is missing", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    const { default: ProjectMemoryPage } = await import("./page");

    await expect(
      ProjectMemoryPage({ params: Promise.resolve({ projectId: "gone" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(projectServiceMock.getProjectContextMd).not.toHaveBeenCalled();
  });

  it("reads the document on the server so the tab arrives with it", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    projectServiceMock.getProjectContextMd.mockResolvedValue({
      ...CONTEXT_MD,
      content: "# Project Context\n\n## Active goals\n- Ship the studio.",
    });

    const { default: ProjectMemoryPage } = await import("./page");
    render(
      await ProjectMemoryPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(projectServiceMock.getProjectContextMd).toHaveBeenCalledWith(
      "project-1",
    );
    const panel = screen.getByTestId("memory-panel");
    expect(panel).toHaveAttribute("data-version", "47");
    expect(panel.getAttribute("data-content")).toContain("Ship the studio");
  });

  it("does not ask Core for a document the project has never had", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(
      buildProject({ contextMd: null }),
    );

    const { default: ProjectMemoryPage } = await import("./page");
    render(
      await ProjectMemoryPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(projectServiceMock.getProjectContextMd).not.toHaveBeenCalled();
    expect(screen.getByTestId("memory-panel")).toHaveAttribute(
      "data-content",
      "",
    );
  });

  it("passes on whether updates are running and whether they are configured", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(
      buildProject({ contextMdUpdating: true, memoryEnabled: false }),
    );
    projectServiceMock.getProjectContextMd.mockResolvedValue({
      ...CONTEXT_MD,
      content: "# Project Context",
    });

    const { default: ProjectMemoryPage } = await import("./page");
    render(
      await ProjectMemoryPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    const panel = screen.getByTestId("memory-panel");
    expect(panel).toHaveAttribute("data-updating", "true");
    expect(panel).toHaveAttribute("data-enabled", "false");
  });

  it("marks Memory as the open tab in the shared tab strip", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(buildProject());
    projectServiceMock.getProjectContextMd.mockResolvedValue({
      ...CONTEXT_MD,
      content: "# Project Context",
    });

    const { default: ProjectMemoryPage } = await import("./page");
    render(
      await ProjectMemoryPage({
        params: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(
      screen.getByRole("link", { name: "App.Projects.Detail.tabs.memory" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("heading", { name: "Launch plan" }),
    ).toBeInTheDocument();
  });
});
