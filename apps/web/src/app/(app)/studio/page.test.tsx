import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { imageStudioServiceMock, projectServiceMock } = vi.hoisted(() => ({
  imageStudioServiceMock: {
    getCatalog: vi.fn(),
    getState: vi.fn(),
    getWorkspaceState: vi.fn(),
  },
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
    catalog: { models: unknown[] };
    initialSelectedAssetId: string | null;
    projectId: string | null;
  }) => (
    <div
      data-testid="image-studio"
      data-catalog-models={props.catalog.models.length}
      data-project={props.projectId ?? "workspace"}
      data-selected={props.initialSelectedAssetId ?? ""}
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

function studioState(overrides: Partial<{ assets: { id: string }[] }> = {}) {
  // `sessions` is still in Core's payload — the agent surface uses it — but the
  // studio page no longer reads it, so nothing here needs to fake one.
  return { assets: [], sessions: [], ...overrides };
}

const CATALOG = {
  defaultModelId: "model-a",
  models: [{ id: "model-a" }],
  snapshotDate: "2026-09-27",
  refreshedAt: null,
};

describe("StudioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageStudioServiceMock.getCatalog.mockResolvedValue(CATALOG);
  });

  it("opens the workspace studio when no scope is set", async () => {
    imageStudioServiceMock.getWorkspaceState.mockResolvedValue(studioState());
    const { default: StudioPage } = await import("./page");

    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-project",
      "workspace",
    );
    expect(screen.queryByTestId("studio-no-project")).not.toBeInTheDocument();
    // Nothing is loaded for a project nobody named.
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(imageStudioServiceMock.getState).not.toHaveBeenCalled();
    expect(imageStudioServiceMock.getWorkspaceState).toHaveBeenCalledWith({});
  });

  it("treats a blank projectId as no scope rather than as a project", async () => {
    imageStudioServiceMock.getWorkspaceState.mockResolvedValue(studioState());
    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({ searchParams: Promise.resolve({ projectId: " " }) }),
    );

    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-project",
      "workspace",
    );
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

  it("opens the scoped project's gallery with nothing visible above it", async () => {
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
    expect(screen.queryByTestId("studio-no-project")).not.toBeInTheDocument();
  });

  /**
   * The identity row is gone, and the page outline is not.
   *
   * The mark, the product name and the project name repeated the sidebar row,
   * the breadcrumb and the project switcher, in the one band of the page the
   * composer wanted — so they went. What must not go with them is the page's
   * `h1`: everything the studio renders below it is a section *of* something,
   * and an outline that starts at `h2` leaves a screen-reader reader with no
   * way to place the page. So the heading stays and is `sr-only`.
   */
  it("keeps one accessible heading and no visible headline row", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(studioState());

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    const headings = screen.getAllByRole("heading");
    expect(headings).toHaveLength(1);
    const [heading] = headings;
    expect(heading.tagName).toBe("H1");
    // The same key the document title reads, so the tab and the outline cannot
    // disagree about what this page is called.
    expect(heading).toHaveTextContent("App.Studio.title");
    // Hidden by the class, not by `display: none` — visually absent, present
    // in the accessibility tree. No stylesheet runs here, so the class is the
    // only thing that can be asserted on.
    expect(heading).toHaveClass("sr-only");
    // And the project name the row used to carry beside it is still gone. (The
    // studio's own `Templates`/`Images` headings are inside the mocked child,
    // so this file cannot and does not speak for them.)
    expect(screen.queryByText("Launch plan")).not.toBeInTheDocument();
  });

  /**
   * The catalog is ~158KB for 152 models, and Core took it off the state
   * payload for that reason: an open studio refetches state every three seconds
   * while something is running. It is read here, once per render, and handed
   * down — so the poll carries assets and jobs and nothing else.
   */
  it("reads the catalog once, and hands it to the studio", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(studioState());

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(imageStudioServiceMock.getCatalog).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-catalog-models",
      "1",
    );
  });

  it("does not read the catalog for a scope this workspace lost", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);
    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-gone" }),
      }),
    );

    // Nothing to show it against, so nothing is downloaded for it.
    expect(imageStudioServiceMock.getCatalog).not.toHaveBeenCalled();
  });

  it("names the page in the document title", async () => {
    const { generateMetadata } = await import("./page");

    await expect(generateMetadata()).resolves.toEqual({
      title: "App.Studio.title",
    });
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

  it("survives a selection Core will not accept, instead of taking the page down", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState
      .mockRejectedValueOnce(new Error("Invalid uuid"))
      .mockResolvedValueOnce(studioState());

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({
          projectId: "project-1",
          v: "not-an-id",
        }),
      }),
    );

    // A `?v=` from a saved link can name a deleted asset, another project's
    // asset, or no asset at all. Asking for it is an optimisation, so a
    // refusal costs one more round trip and nothing else.
    expect(imageStudioServiceMock.getState).toHaveBeenNthCalledWith(
      1,
      "project-1",
      { assetId: "not-an-id" },
    );
    expect(imageStudioServiceMock.getState).toHaveBeenNthCalledWith(
      2,
      "project-1",
      {},
    );
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-selected",
      "",
    );
  });
});
