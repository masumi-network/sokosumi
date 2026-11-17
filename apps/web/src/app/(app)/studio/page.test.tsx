import { fireEvent, render, screen } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { consumeStudioWebsiteDraftRequest } from "@/app/projects/components/image-studio/studio-website-intent";
import { expectConsole } from "@/test/console";

const {
  connectionMock,
  imageStudioServiceMock,
  projectServiceMock,
  openProjectScopeMock,
  openScopeCreateMock,
  setScopeCreateOpenMock,
  useHasAnyScopeProjectMock,
} = vi.hoisted(() => ({
  connectionMock: vi.fn(async () => undefined),
  openProjectScopeMock: vi.fn(),
  openScopeCreateMock: vi.fn(),
  setScopeCreateOpenMock: vi.fn(),
  useHasAnyScopeProjectMock: vi.fn(),
  imageStudioServiceMock: {
    getCatalog: vi.fn(),
    getRecentProjects: vi.fn(),
    getState: vi.fn(),
    getWorkspaceState: vi.fn(),
  },
  projectServiceMock: { getProjectById: vi.fn() },
}));

vi.mock("server-only", () => ({}));

vi.mock("next/server", () => ({ connection: connectionMock }));

vi.mock("next/cache", () => ({ cacheLife: () => undefined }));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) =>
    `${namespace}.${key}`,
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) => (key: string, values?: { count?: number }) =>
      values?.count === undefined
        ? `${namespace}.${key}`
        : `${namespace}.${key}:${values.count}`,
  useFormatter: () => ({ dateTime: () => "Nov 11" }),
}));

vi.mock("@/lib/services/project.service", () => ({
  projectService: projectServiceMock,
}));

vi.mock("@/lib/services/image-studio.service", () => ({
  imageStudioService: imageStudioServiceMock,
}));

vi.mock("@/app/projects/components/project-brand-card", () => ({
  ProjectBrandProvider: ({
    children,
    autoStart,
  }: {
    children: React.ReactNode;
    autoStart?: boolean;
  }) => (
    <div data-testid="studio-brand-provider" data-auto-start={autoStart}>
      {children}
    </div>
  ),
}));

vi.mock("@/app/projects/components/image-studio/image-studio", () => ({
  ImageStudio: (props: {
    catalog: { models: unknown[] };
    initialSelectedAssetId: string | null;
    projectId: string | null;
    projectScopePrompt?: React.ReactNode;
    recentProjects?: React.ReactNode;
    initialState: { assets: unknown[] };
  }) => (
    <div
      data-testid="image-studio"
      data-catalog-models={props.catalog.models.length}
      data-assets={props.initialState.assets.length}
      data-project={props.projectId ?? "workspace"}
      data-selected={props.initialSelectedAssetId ?? ""}
    >
      {props.recentProjects}
      {props.projectScopePrompt}
    </div>
  ),
}));

// The picker reaches for the sidebar switcher's list, which reads the session
// through react-query. This file is about which state the page chooses.
vi.mock("@/app/components/project-scope/sidebar-project-scope-state", () => ({
  openProjectScope: openProjectScopeMock,
  openScopeCreate: openScopeCreateMock,
  setScopeCreateOpen: setScopeCreateOpenMock,
}));

vi.mock("@/app/components/project-scope/use-project-scope", () => ({
  useProjectScopeSwitch: () => ({ select: vi.fn() }),
}));

vi.mock("@/app/components/project-scope/use-scope-projects", () => ({
  useHasAnyScopeProject: useHasAnyScopeProjectMock,
}));

// happy-dom fetches no image, so every <img> reads as finished and empty: a
// failed load. A browser still loading it says `complete: false`.
const IMAGE_COMPLETE = Object.getOwnPropertyDescriptor(
  HTMLImageElement.prototype,
  "complete",
);
beforeAll(() => {
  Object.defineProperty(HTMLImageElement.prototype, "complete", {
    configurable: true,
    get: () => false,
  });
});
afterAll(() => {
  if (IMAGE_COMPLETE) {
    Object.defineProperty(
      HTMLImageElement.prototype,
      "complete",
      IMAGE_COMPLETE,
    );
  }
});

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
    imageStudioServiceMock.getRecentProjects.mockResolvedValue([]);
    useHasAnyScopeProjectMock.mockReturnValue({
      isPending: false,
      hasProjects: true,
    });
  });

  it("shows curated styles and project selection without opening the selector on arrival", async () => {
    const { default: StudioPage } = await import("./page");

    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-project",
      "workspace",
    );
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-assets",
      "0",
    );
    expect(screen.getByTestId("studio-no-project")).toHaveTextContent(
      "App.ProjectScope.selectProject",
    );
    expect(screen.queryByText("App.Studio.pickBody")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "App.Studio.pickTitle" }),
    ).not.toBeInTheDocument();
    // The selector opens over the curated gallery, asking for a project.
    // Arrival leaves it closed; the button is the explicit request.
    expect(openProjectScopeMock).not.toHaveBeenCalled();
    const button = screen.getByRole("button", {
      name: "App.ProjectScope.selectProject",
    });
    fireEvent.click(button);
    expect(openProjectScopeMock).toHaveBeenCalledWith({
      required: true,
      reason: "App.Studio.pickBody",
      onSelect: expect.any(Function),
      onCreated: expect.any(Function),
    });
    expect(openScopeCreateMock).not.toHaveBeenCalled();
    // Nothing is loaded for a project nobody named.
    expect(projectServiceMock.getProjectById).not.toHaveBeenCalled();
    expect(imageStudioServiceMock.getState).not.toHaveBeenCalled();
    expect(imageStudioServiceMock.getWorkspaceState).not.toHaveBeenCalled();
  });

  it("offers project creation without opening the selector in an empty workspace", async () => {
    useHasAnyScopeProjectMock.mockReturnValue({
      isPending: false,
      hasProjects: false,
    });
    const { default: StudioPage } = await import("./page");

    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByTestId("image-studio")).toBeInTheDocument();
    expect(openProjectScopeMock).not.toHaveBeenCalled();
    expect(openScopeCreateMock).not.toHaveBeenCalled();
    const button = screen.getByRole("button", {
      name: "App.Studio.startFromWebsite",
    });
    fireEvent.click(button);
    expect(openProjectScopeMock).toHaveBeenCalledWith({
      required: true,
      reason: "App.Studio.pickBody",
      onSelect: expect.any(Function),
      onCreated: expect.any(Function),
    });
    expect(openScopeCreateMock).toHaveBeenCalledExactlyOnceWith(button);
    const request = openProjectScopeMock.mock.calls[0][0];
    request.onCreated("without-website", null);
    expect(consumeStudioWebsiteDraftRequest("without-website")).toBe(false);
    request.onCreated("with-website", "https://shop.example/");
    expect(consumeStudioWebsiteDraftRequest("unrelated")).toBe(false);
    expect(consumeStudioWebsiteDraftRequest("with-website")).toBe(true);
    expect(consumeStudioWebsiteDraftRequest("with-website")).toBe(false);
  });

  it("opens the website setup wizard even when the workspace already has projects", async () => {
    const { default: StudioPage } = await import("./page");
    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("button", { name: "App.ProjectScope.selectProject" }),
    ).toBeInTheDocument();
    const setup = screen.getByRole("button", {
      name: "App.Studio.startFromWebsite",
    });
    fireEvent.click(setup);

    expect(openScopeCreateMock).toHaveBeenCalledExactlyOnceWith(setup);
  });

  it("treats a blank projectId as no scope rather than as a project", async () => {
    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({ searchParams: Promise.resolve({ projectId: " " }) }),
    );

    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-project",
      "workspace",
    );
    expect(screen.getByTestId("project-scope-select-button")).toHaveTextContent(
      "App.ProjectScope.selectProject",
    );
    expect(openProjectScopeMock).not.toHaveBeenCalled();
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
    expect(
      screen.queryByText("App.Studio.pickUnavailable"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "App.Studio.pickTitle" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-project",
      "workspace",
    );
    expect(openProjectScopeMock).not.toHaveBeenCalled();
    const button = screen.getByRole("button", {
      name: "App.ProjectScope.selectProject",
    });
    fireEvent.click(button);
    expect(openProjectScopeMock).toHaveBeenCalledWith({
      required: true,
      reason: "App.Studio.pickUnavailable",
      onSelect: expect.any(Function),
      onCreated: expect.any(Function),
    });
    expect(openScopeCreateMock).not.toHaveBeenCalled();
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
    expect(screen.getByTestId("studio-brand-provider")).toHaveAttribute(
      "data-auto-start",
      "false",
    );

    expect(imageStudioServiceMock.getState).toHaveBeenCalledWith(
      "project-1",
      {},
    );
    const studio = screen.getByTestId("image-studio");
    expect(studio).toHaveAttribute("data-project", "project-1");
    expect(screen.queryByTestId("studio-no-project")).not.toBeInTheDocument();
    expect(openProjectScopeMock).not.toHaveBeenCalled();
  });

  /**
   * The identity row is gone, and the page outline is not.
   *
   * The mark, the product name and the project name repeated the sidebar row
   * and the project selector, in the one band of the page the
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

  // The reads are cached, so a link prefetch carries the page.
  // connection() would drop it back to the skeleton.
  it("renders the scoped project without deferring to the request", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(studioState());

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-project",
      "project-1",
    );
    expect(connectionMock).not.toHaveBeenCalled();
  });

  // A prefetch must not keep a failed read as the page the click opens.
  it("renders a failed catalog read fresh on the click", async () => {
    imageStudioServiceMock.getCatalog
      .mockRejectedValueOnce(new Error("Core answered 503"))
      .mockResolvedValue(CATALOG);

    const { default: StudioPage } = await import("./page");

    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(connectionMock).toHaveBeenCalledOnce();
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-catalog-models",
      "1",
    );
  });

  // A Core 401 on a read the page can do without must still sign the reader
  // out, instead of hiding the shortcut.
  it("keeps a sign-in redirect from the recent projects read", async () => {
    const { redirect } = await import("next/navigation");
    imageStudioServiceMock.getRecentProjects.mockImplementation(async () =>
      redirect("/signin"),
    );

    const { default: StudioPage } = await import("./page");

    await expect(
      StudioPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT");
  });

  it("reads the creative catalog for a scope this workspace lost", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(null);
    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-gone" }),
      }),
    );

    // For project-specific state:
    // Nothing to show it against, so nothing is downloaded for it.
    // The curated landing page still has styles to show after access is lost.
    expect(imageStudioServiceMock.getCatalog).toHaveBeenCalledOnce();
    expect(imageStudioServiceMock.getState).not.toHaveBeenCalled();
  });

  it("loads the public studio for a project", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(studioState());

    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(screen.getByTestId("image-studio")).toBeInTheDocument();
  });

  it("leads All projects with the newest Studio projects, each linking to its gallery", async () => {
    imageStudioServiceMock.getRecentProjects.mockResolvedValue([
      {
        projectId: "project-1",
        projectName: "Autumn menu",
        imageCount: 24,
        latestAt: new Date("2026-11-11T10:00:00.000Z"),
        latestImageId: "asset-9",
      },
    ]);
    const { default: StudioPage } = await import("./page");

    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByRole("heading", { name: "App.Studio.RecentProjects.title" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Autumn menu/ });
    expect(link).toHaveAttribute("href", "/studio?projectId=project-1");
    expect(link).toHaveTextContent(
      "App.Studio.RecentProjects.imageCount:24 · Nov 11",
    );
    expect(link.querySelector("img")).toHaveAttribute(
      "src",
      "/api/projects/project-1/image-studio/assets/asset-9/content",
    );
    // Picking a project from here is still possible.
    expect(screen.getByTestId("studio-no-project")).toBeInTheDocument();
  });

  it("keeps the first-ad screen when recent projects are empty or unavailable", async () => {
    expectConsole("warn", "Image studio: recent projects unavailable");
    imageStudioServiceMock.getRecentProjects.mockRejectedValue(
      new Error("Core down"),
    );
    const { default: StudioPage } = await import("./page");

    render(await StudioPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.queryByRole("heading", {
        name: "App.Studio.RecentProjects.title",
      }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("image-studio")).toBeInTheDocument();
  });

  it("does not ask for recent projects inside a project", async () => {
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    imageStudioServiceMock.getState.mockResolvedValue(studioState());
    const { default: StudioPage } = await import("./page");

    render(
      await StudioPage({
        searchParams: Promise.resolve({ projectId: "project-1" }),
      }),
    );

    expect(imageStudioServiceMock.getRecentProjects).not.toHaveBeenCalled();
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
    expectConsole(
      "warn",
      "Image studio: ignoring an unusable selection from the URL",
    );
    projectServiceMock.getProjectById.mockResolvedValue(PROJECT);
    // Once-only answers: clearAllMocks keeps an implementation, and a lasting
    // one would leak into later tests.
    imageStudioServiceMock.getState
      .mockRejectedValueOnce(new Error("Invalid uuid"))
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
    // The prefetch cache keeps no fallback: the open studio keeps its first
    // state, so a refresh could not repair one. The click reads fresh, and
    // only that read falls back to the newest page.
    expect(connectionMock).toHaveBeenCalledOnce();
    expect(
      imageStudioServiceMock.getState.mock.calls.map(([, query]) => query),
    ).toEqual([{ assetId: "not-an-id" }, { assetId: "not-an-id" }, {}]);
    expect(screen.getByTestId("image-studio")).toHaveAttribute(
      "data-selected",
      "",
    );
  });
});
