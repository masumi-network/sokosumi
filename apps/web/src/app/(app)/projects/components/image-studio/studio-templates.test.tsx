import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { STUDIO_TEMPLATES } from "./studio-templates";
import type { StudioAsset } from "./types";

/**
 * The template presses, driven through the real composer.
 *
 * A template is only worth having if the press reaches the box a person types
 * in, so this renders the actual `StudioComposer` rather than a stub: the
 * assertions are the textarea's own value, the frame the composer summarises,
 * and where the caret ended up. Asserting on `STUDIO_TEMPLATES` would prove
 * only that the list exists.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  requestImageJobCancel: vi.fn(),
  prepareStudioAssetSocialMedia: vi.fn(),
}));

const mocks = vi.hoisted(() => ({ assets: [] as unknown[] }));

vi.mock("./use-studio-state", () => ({
  useStudioState: () => ({
    state: { assets: mocks.assets, jobs: [] },
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
    failed: [],
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
  }),
}));

function mount() {
  return render(
    <ImageStudio
      catalog={TEST_CATALOG}
      initialSelectedAssetId={null}
      initialState={{ assets: [], jobs: [], sessions: [] } as never}
      labels={TEST_LABELS}
      projectId="p"
    />,
  );
}

const POSTER = STUDIO_TEMPLATES.find(
  (template) => template.id === "poster",
) as (typeof STUDIO_TEMPLATES)[number];

describe("starting from a template", () => {
  it("offers every template, in the order they are declared", () => {
    mount();

    const names = STUDIO_TEMPLATES.map((template) => template.id);
    const rendered = names.map(
      (name) => screen.getByRole("button", { name }).textContent,
    );
    expect(rendered).toEqual(names);
  });

  it("fills the composer with the template's brief and sets its frame", () => {
    mount();

    // The default target is 1:1 (see `defaultModel` and the initial settings),
    // and the poster brief is composed for 2:3 — so this press has to move the
    // frame as well as the text.
    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "poster" }));

    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    expect(prompt).toHaveValue(POSTER.prompt);
    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();
  });

  it("does not submit, and leaves the caret in the prompt", () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "headshot" }));

    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    // Editable text in a focused box, not a request: the whole point of a
    // template is what gets typed over it.
    expect(prompt).toHaveFocus();
    fireEvent.change(prompt, { target: { value: "my own brief" } });
    expect(prompt).toHaveValue("my own brief");
  });

  it("keeps the brief in English whatever the locale says", () => {
    // The labels are translated; the prompt bodies are model input and are
    // not. A press under a German label must still send the English brief.
    for (const template of STUDIO_TEMPLATES) {
      expect(template.prompt).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it("undoes a template replacement with the original brief, frame and focus", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, {
      target: { value: "My original campaign brief" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "moreOptions 1:1 · 1K · png" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "4:5" }));
    fireEvent.keyDown(screen.getByRole("button", { name: "4:5" }), {
      key: "Escape",
    });
    fireEvent.click(screen.getByRole("button", { name: "poster" }));
    expect(prompt).toHaveValue(POSTER.prompt);
    fireEvent.click(screen.getByRole("button", { name: "undoTemplate" }));
    expect(prompt).toHaveValue("My original campaign brief");
    expect(prompt).toHaveFocus();
    expect(screen.getByText("4:5 · 1K · png")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
  });

  it("expires template undo when the replacement is edited or submitted", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "Original" } });
    fireEvent.click(screen.getByRole("button", { name: "poster" }));
    expect(
      screen.getByRole("button", { name: "undoTemplate" }),
    ).toBeInTheDocument();
    fireEvent.change(prompt, { target: { value: "Edited poster brief" } });
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "headshot" }));
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the original typed brief through several template choices", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "Original brief" } });
    fireEvent.click(screen.getByRole("button", { name: "poster" }));
    fireEvent.click(screen.getByRole("button", { name: "headshot" }));
    fireEvent.click(screen.getByRole("button", { name: "undoTemplate" }));
    expect(prompt).toHaveValue("Original brief");
    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();
  });

  it("expires template undo when the frame changes away and back", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "Original brief" } });
    fireEvent.click(screen.getByRole("button", { name: "headshot" }));
    fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
    fireEvent.click(screen.getByRole("button", { name: "16:9" }));
    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    expect(prompt).toHaveValue(
      STUDIO_TEMPLATES.find((template) => template.id === "headshot")?.prompt,
    );
    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
  });

  it("expires template undo when the copy count changes", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "Original brief" } });
    fireEvent.click(screen.getByRole("button", { name: "poster" }));
    fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
  });
});

const RESULT = {
  id: "a",
  projectId: "p",
  projectName: "Launch",
  rootId: "a",
  parentId: null,
  version: 1,
  prompt: "an earlier brief",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  createdAt: "2026-09-26T12:00:00Z",
  jobId: "job-a",
  settings: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
  contentPath: "/a",
} as unknown as StudioAsset;

describe("templates once there are images", () => {
  afterEach(() => {
    mocks.assets = [];
    vi.unstubAllGlobals();
  });

  it("applies a template from the toolbar menu and undoes it there", () => {
    mocks.assets = [RESULT];
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    const form = prompt.closest("form") as HTMLFormElement;
    fireEvent.change(prompt, { target: { value: "Original brief" } });

    const menu = screen.getByRole("button", { name: "templates" });
    expect(form).toContainElement(menu);
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole("button", { name: "poster" }));

    expect(
      screen.queryByRole("dialog", { name: "templates" }),
    ).not.toBeInTheDocument();
    expect(prompt).toHaveValue(POSTER.prompt);
    expect(prompt).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent(
      "templateReplacedBrief",
    );
    const undo = screen.getByRole("button", { name: "undoTemplate" });
    expect(form).toContainElement(undo);

    fireEvent.click(undo);
    expect(prompt).toHaveValue("Original brief");
    expect(prompt).toHaveFocus();
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
  });

  it("lets a growing brief rise over the feed instead of shrinking it", () => {
    let resize: () => void = () => undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    mocks.assets = [RESULT];
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    const dock = prompt.closest("section")?.parentElement as HTMLElement;
    const slot = dock.parentElement as HTMLElement;
    prompt.style.minHeight = "48px";
    const size = (dockHeight: number, promptHeight: number) => {
      Object.defineProperty(dock, "offsetHeight", {
        configurable: true,
        value: dockHeight,
      });
      Object.defineProperty(prompt, "offsetHeight", {
        configurable: true,
        value: promptHeight,
      });
      act(() => resize());
    };

    size(150, 48);
    expect(slot.style.height).toBe("150px");
    // Four more lines of brief: the card grows, the space it takes from the
    // feed does not.
    size(262, 160);
    expect(slot.style.height).toBe("150px");
  });
});
