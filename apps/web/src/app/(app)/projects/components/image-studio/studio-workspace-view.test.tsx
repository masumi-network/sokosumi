import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { STUDIO_TEMPLATES } from "./studio-templates";
import type { StudioAsset } from "./types";

/**
 * The studio with no project picked: every project's images, and nothing is
 * generated until it is clear which project it goes to.
 */

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "day" }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  requestImageJobCancel: vi.fn(),
}));

vi.mock("@/app/components/project-scope/project-scope-menu", () => ({
  ProjectScopeMenu: ({
    includeWorkspace,
    onSelect,
    onDone,
  }: {
    includeWorkspace?: boolean;
    onSelect: (projectId: string | null) => void;
    onDone?: () => void;
  }) => (
    <div data-include-workspace={String(includeWorkspace)}>
      <button
        onClick={() => {
          onSelect("project-picked");
          onDone?.();
        }}
        type="button"
      >
        Picked project
      </button>
    </div>
  ),
}));

vi.mock("./use-studio-state", () => ({
  useStudioState: ({
    initialState,
  }: {
    initialState: { assets: StudioAsset[] };
  }) => ({
    state: { ...initialState, jobs: [] },
    selectedAsset: null,
    selectAsset: vi.fn(),
    activeJobs: [],
    refresh: vi.fn().mockResolvedValue(undefined),
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    queued: [],
    enqueue: mocks.enqueue,
    waitingForSlot: false,
    lastError: null,
    clearError: vi.fn(),
  }),
}));

function asset(id: string, projectId: string, projectName: string) {
  return {
    id,
    projectId,
    projectName,
    rootId: id,
    parentId: null,
    version: 1,
    prompt: `prompt ${id}`,
    model: "vendor/model-a",
    width: 1024,
    height: 1024,
    bytes: 1000,
    contentType: "image/png",
    createdAt: "2026-09-26T12:00:00Z",
    jobId: `job-${id}`,
    settings: {
      aspectRatio: "1:1",
      resolution: "1K",
      outputFormat: "png",
      seed: null,
    },
    contentPath: `/${id}`,
  } as unknown as StudioAsset;
}

const LAUNCH = asset("a", "project-launch", "Launch");
const BRAND = asset("b", "project-brand", "Brand");

function mount(projectId: string | null, assets = [LAUNCH, BRAND]) {
  return render(
    <ImageStudio
      catalog={TEST_CATALOG}
      initialSelectedAssetId={null}
      initialState={{ assets, jobs: [], nextCursor: null } as never}
      labels={TEST_LABELS}
      projectId={projectId}
    />,
  );
}

function generate(prompt = "a fox") {
  const box = screen.getByRole("textbox", { name: "promptPlaceholder" });
  fireEvent.change(box, { target: { value: prompt } });
  fireEvent.keyDown(box, { key: "Enter", metaKey: true });
}

beforeEach(() => vi.clearAllMocks());

describe("the workspace view", () => {
  it("opens the same empty studio without requiring a project", () => {
    mount(null, []);
    expect(screen.getByRole("region", { name: "templates" })).toHaveAttribute(
      "aria-roledescription",
      "carousel",
    );
    expect(
      screen.getByRole("textbox", { name: "promptPlaceholder" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("pickForGeneration")).not.toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });

  it("moves the styles above the prompt as images appear, then returns them when empty", () => {
    const props = {
      catalog: TEST_CATALOG,
      initialSelectedAssetId: null,
      labels: TEST_LABELS,
      projectId: null,
    };
    const view = render(
      <ImageStudio
        {...props}
        initialState={{ assets: [], jobs: [], nextCursor: null } as never}
      />,
    );
    expect(
      screen.getByRole("region", { name: "templates" }),
    ).toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(box, { target: { value: "keep my draft" } });

    view.rerender(
      <ImageStudio
        {...props}
        initialState={{ assets: [LAUNCH], jobs: [], nextCursor: null } as never}
      />,
    );
    expect(
      screen.queryByRole("region", { name: "templates" }),
    ).not.toBeInTheDocument();
    const styles = screen.getByRole("group", { name: "templates" });
    expect(
      styles.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "poster" })).toHaveLength(1);
    expect(box).toHaveValue("keep my draft");

    view.rerender(
      <ImageStudio
        {...props}
        initialState={{ assets: [], jobs: [], nextCursor: null } as never}
      />,
    );
    expect(
      screen.getByRole("region", { name: "templates" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "templates" }),
    ).not.toBeInTheDocument();
    expect(box).toHaveValue("keep my draft");
  });

  it("preserves the selected style and frame after cancelling the project picker", async () => {
    mount(null, []);
    fireEvent.click(screen.getByRole("button", { name: "headshot" }));
    const template = STUDIO_TEMPLATES.find(
      (candidate) => candidate.id === "headshot",
    )!;
    const box = screen.getByRole("textbox", { name: "promptPlaceholder" });
    expect(box).toHaveValue(template.prompt);
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    fireEvent.keyDown(screen.getByText("Picked project"), { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByText("pickForGeneration")).not.toBeInTheDocument(),
    );
    expect(box).toHaveValue(template.prompt);
    expect(screen.getByText("4:5 · 1K · png")).toBeInTheDocument();
    expect(mocks.enqueue).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Picked project" }));
    expect(mocks.enqueue).toHaveBeenCalledTimes(1);
    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request).toMatchObject({
        projectId: "project-picked",
        prompt: template.prompt,
        settings: { aspectRatio: "4:5", resolution: "1K", outputFormat: "png" },
      });
    }
  });

  it("labels every image with the project it lives in", () => {
    mount(null);
    expect(screen.getByText("Launch")).toBeInTheDocument();
    expect(screen.getByText("Brand")).toBeInTheDocument();
  });

  it("does not label images inside one project", () => {
    mount("project-launch", [LAUNCH]);
    expect(screen.queryByText("Launch")).not.toBeInTheDocument();
  });

  it("asks for a project before generating, and keeps the brief meanwhile", () => {
    mount(null);
    generate("a fox");

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(screen.getByText("pickForGeneration")).toBeInTheDocument();
    // A project is required here, so the workspace itself is not a choice.
    expect(
      screen.getByText("Picked project").closest("[data-include-workspace]"),
    ).toHaveAttribute("data-include-workspace", "false");
    expect(
      screen.getByRole("textbox", { name: "promptPlaceholder" }),
    ).toHaveValue("a fox");
  });

  it("sends the batch to the picked project and clears the brief", () => {
    mount(null);
    generate("a fox");
    fireEvent.click(screen.getByRole("button", { name: "Picked project" }));

    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(request).toMatchObject({
        projectId: "project-picked",
        prompt: "a fox",
      });
    }
    expect(
      screen.getByRole("textbox", { name: "promptPlaceholder" }),
    ).toHaveValue("");
  });

  it("runs a variation in the image's own project without asking", () => {
    mount(null);
    fireEvent.click(screen.getAllByRole("button", { name: "regenerate" })[1]!);

    // Tiles are oldest first, so the second one is the first asset.
    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests[0]).toMatchObject({ projectId: LAUNCH.projectId });
    expect(screen.queryByText("pickForGeneration")).not.toBeInTheDocument();
  });

  it("aims a batch with references at their project", () => {
    mount(null);
    fireEvent.click(screen.getAllByRole("button", { name: "select" })[0]!);
    generate();

    const [[requests]] = mocks.enqueue.mock.calls;
    expect(requests[0]).toMatchObject({
      projectId: BRAND.projectId,
      referenceAssetIds: [BRAND.id],
    });
  });

  it("refuses references from two projects instead of guessing", () => {
    mount(null);
    for (const box of screen.getAllByRole("button", { name: "select" })) {
      fireEvent.click(box);
    }
    generate();

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(screen.getByText("referencesAcrossProjects")).toBeInTheDocument();
  });
});
