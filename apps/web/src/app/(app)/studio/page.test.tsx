import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { imageStudioServiceMock, projectServiceMock } = vi.hoisted(() => ({
  imageStudioServiceMock: { getState: vi.fn() },
  projectServiceMock: { getProjectById: vi.fn() },
}));

vi.mock("next/server", () => ({ connection: async () => undefined }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/lib/services/image-studio.service", () => ({
  imageStudioService: imageStudioServiceMock,
}));

vi.mock("@/app/projects/components/image-studio/image-studio", () => ({
  ImageStudio: (props: {
    initialSelectedAssetId: string | null;
    projectId: string;
    resumeSessionId: string | null;
  }) => (
    <div
      data-testid="image-studio"
      data-project={props.projectId}
      data-selected={props.initialSelectedAssetId ?? ""}
      data-session={props.resumeSessionId ?? ""}
    />
  ),
}));

// The picker reaches for the sidebar switcher's list, which reads the session
// through react-query. This file is about which state the page chooses.
vi.mock("./components/studio-project-picker", () => ({
  StudioProjectPicker: ({ notice }: { notice?: string }) => (
    <div data-testid="studio-no-project">{notice ?? "pick a project"}</div>
  ),
}));

const PROJECT = {
  id: "project-1",
  name: "Launch plan",
  logo: null,
  updatedAt: new Date("2026-05-27T10:00:00.000Z"),
};

function studioState(
  overrides: Partial<{
    assets: { id: string }[];
    sessions: { eveSessionId: string }[];
  }> = {},
) {
  return { assets: [], sessions: [], ...overrides };
}

describe("StudioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks which project to work in when no scope is set", async () => {
    const { default: StudioPage } = await import("./page");

    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("studio-no-project")).toBeInTheDocument();
    expect(screen.queryByTestId("image-studio")).not.toBeInTheDocument();
    // Nothing is loaded for a project nobody named.
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(imageStudioServiceMock.getState).not.toHaveBeenCalled();
  });

  it("treats a blank projectId as no scope rather than as a project", async () => {
    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({ searchParams: Promise.resolve({ projectId: " " }) }),
    );

    expect(screen.getByTestId("studio-no-project")).toBeInTheDocument();
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
  });

  it("offers another project instead of 404ing on a scope this workspace lost", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-gone" }),
      }),
    );

    // The id came from a switchable scope, not from the path: the repair is to
    // pick another project, not to leave the page.
    expect(screen.getByTestId("studio-no-project")).toHaveTextContent(
      "App.Studio.pickUnavailable",
    );
    expect(imageStudioServiceMock.getState).not.toHaveBeenCalled();
  });

  it("opens the scoped project's gallery under the project's own name", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(studioState());

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(imageStudioServiceMock.getState).toHaveBeenCalledWith(
      "project-1",
      {},
    );
    const studio = screen.getByTestId("image-studio");
    expect(studio).toHaveAttribute("data-project", "project-1");
    expect(
      screen.getByRole("heading", { name: "App.Studio.title" }),
    ).toBeInTheDocument();
    // Which project's images these are, said on the page rather than only in
    // the sidebar's switcher.
    expect(screen.getByText("Launch plan")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-no-project")).not.toBeInTheDocument();
  });

  it("asks Core for a selected version that may be older than the newest page", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(
      studioState({ assets: [{ id: "asset-7" }] }),
    );

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-1", v: "asset-7" }),
      }),
    );

    expect(imageStudioServiceMock.getState).toHaveBeenCalledWith("project-1", {
      assetId: "asset-7",
    });
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-selected",
      "asset-7",
    );
  });

  it("resumes only a conversation Core reports as bound to this project", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(
      studioState({ sessions: [{ eveSessionId: "session-mine" }] }),
    );

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({
          projectId: "project-1",
          s: "session-someone-elses",
        }),
      }),
    );

    // A session id in the URL is a request to resume, not a right to.
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-session",
      "session-mine",
    );
  });
});
