import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG } from "./studio-fixtures";
import type { StudioAsset, StudioJob, StudioLabels } from "./types";
import { focusableWithin } from "./use-modal-overlay";

/**
 * The assistant, as a thing that covers the page.
 *
 * An independent review found that below `xl` the panel looked like a modal
 * and behaved like nothing: focus stayed on the trigger it had covered, Tab
 * walked into the hidden page, Escape did nothing, and a bare `a` still
 * approved the gallery version underneath. Its reproduction is the first three
 * cases here, kept so the panel cannot quietly stop being a dialog again.
 *
 * The rest are the state guarantees the same review checked by hand: two
 * drafts across a close and reopen, cancellation landing on the tile it was
 * pressed on, and comparison notes surviving the lightbox closing.
 */

const mocks = vi.hoisted(() => ({
  review: vi.fn(),
  cancel: vi.fn(),
  clear: vi.fn(),
  eve: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/projects/p/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  reviewImageVersion: mocks.review,
  clearImageVersionReview: mocks.clear,
  requestImageJobCancel: mocks.cancel,
}));

vi.mock("eve/react", () => ({ useEveAgent: mocks.eve }));

vi.mock("./use-studio-state", () => ({
  useStudioState: ({
    initialState,
  }: {
    initialState: { assets: StudioAsset[]; jobs: StudioJob[] };
  }) => ({
    state: initialState,
    selectedAsset: initialState.assets[0] ?? null,
    selectAsset: vi.fn(),
    activeJobs: initialState.jobs,
    applyAsset: vi.fn(),
    refresh: mocks.refresh,
    loadOlder: vi.fn(),
    hasOlder: false,
    error: null,
  }),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
    lastError: null,
    clearError: vi.fn(),
  }),
}));

const LABELS = new Proxy(
  { examplePrompts: ["Example one", "Example two"] } as Record<string, unknown>,
  { get: (target, key: string) => target[key] ?? key },
) as unknown as StudioLabels;

const ASSET = {
  id: "a",
  rootId: "a",
  parentId: null,
  version: 1,
  prompt: "sample",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  createdAt: "2026-09-26T00:00:00Z",
  jobId: "j",
  settings: {},
  contentPath: "/a",
  review: null,
} as unknown as StudioAsset;

/**
 * The viewport, as the panel reads it.
 *
 * `useIsOverlayWidth` asks `matchMedia` whether the layout is at least `xl`,
 * so a test that wants the overlay says "no" and a test that wants the column
 * says "yes". happy-dom's own `matchMedia` always answers false, which is the
 * overlay case — stating it either way keeps each test honest about which
 * layout it is about.
 */
function setViewport(wide: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

function mount(assets: StudioAsset[] = [], jobs: StudioJob[] = []) {
  return render(
    <ImageStudio
      initialSelectedAssetId={null}
      initialState={
        { catalog: TEST_CATALOG, assets, jobs, sessions: [] } as never
      }
      labels={LABELS}
      projectId="p"
      resumeSessionId={null}
    />,
  );
}

function openAssistant() {
  const trigger = screen.getByRole("button", { name: "chatExpand" });
  trigger.focus();
  fireEvent.click(trigger);
  return trigger;
}

function panel() {
  const node = document.getElementById("studio-assistant");
  if (!node) throw new Error("the assistant is not open");
  return node;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  setViewport(false);
  mocks.eve.mockReturnValue({
    status: "ready",
    error: undefined,
    session: null,
    data: { messages: [] },
    send: vi.fn(),
    prewarm: vi.fn(),
  });
  mocks.review.mockResolvedValue({
    ...ASSET,
    review: { decision: "APPROVED" },
  });
  mocks.cancel.mockResolvedValue({ accepted: true });
});

describe("the assistant while it covers the gallery", () => {
  it("is a dialog, takes focus, and puts it back when dismissed", () => {
    mount();
    const trigger = openAssistant();

    const assistant = panel();
    expect(assistant).toHaveAttribute("role", "dialog");
    expect(assistant).toHaveAttribute("aria-modal", "true");
    expect(assistant).toHaveAccessibleName("chatTitle");
    // Focus moved off the trigger the panel is now covering.
    expect(assistant.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });

    expect(document.getElementById("studio-assistant")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("takes the page underneath out of reach", () => {
    mount([ASSET]);
    openAssistant();

    const gallery = screen.getByRole("button", {
      name: /openDetails/,
    });
    // `inert`, not `aria-hidden`: the gallery has to leave the tab order and
    // stop being clickable, not merely stop being announced.
    expect(gallery.closest("[inert]")).not.toBeNull();
    // The panel stays reachable, and so does the close control inside it.
    // The toolbar's own toggle is deliberately *not* exempt: it is behind the
    // overlay like everything else.
    expect(panel().closest("[inert]")).toBeNull();
    expect(
      within(panel())
        .getByRole("button", { name: "chatCollapse" })
        .closest("[inert]"),
    ).toBeNull();
    // The toolbar's own toggle carries the same name while the panel is open,
    // so it is picked out by being the one *outside* the panel.
    const toolbarToggle = screen
      .getAllByRole("button", { name: "chatCollapse" })
      .find((button) => !panel().contains(button));
    expect(toolbarToggle?.closest("[inert]")).not.toBeNull();
  });

  it("keeps Tab inside itself", () => {
    mount([ASSET]);
    openAssistant();

    // The same list the trap works from, so the test cannot drift from it by
    // counting a disabled control the browser would skip anyway.
    const inside = focusableWithin(panel());
    expect(inside.length).toBeGreaterThan(1);
    const first = inside[0];
    const last = inside[inside.length - 1];

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("stops the page behind it from scrolling under it", () => {
    const scroller = document.createElement("main");
    scroller.setAttribute("data-app-main", "");
    scroller.style.overflow = "auto";
    document.body.appendChild(scroller);

    mount([ASSET]);
    openAssistant();
    expect(scroller.style.overflow).toBe("hidden");

    fireEvent.keyDown(document.activeElement ?? document, { key: "Escape" });
    // Put back what was there, not a guess at what it should be.
    expect(scroller.style.overflow).toBe("auto");

    scroller.remove();
  });

  it("does not let a bare letter decide an image nobody can see", async () => {
    mount([ASSET]);
    openAssistant();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "a" });
      fireEvent.keyDown(document.body, { key: "r" });
    });

    expect(mocks.review).not.toHaveBeenCalled();
  });
});

describe("the assistant while it sits beside the gallery", () => {
  beforeEach(() => setViewport(true));

  it("is not a dialog and leaves the page alone", () => {
    mount([ASSET]);
    const trigger = openAssistant();

    const assistant = panel();
    expect(assistant).not.toHaveAttribute("role", "dialog");
    expect(assistant).not.toHaveAttribute("aria-modal");
    // No focus transfer and nothing made inert: at this width the panel is
    // part of the page, not on top of it.
    expect(document.activeElement).toBe(trigger);
    expect(
      screen.getByRole("button", { name: /openDetails/ }).closest("[inert]"),
    ).toBeNull();
  });

  it("still reviews from the keyboard", async () => {
    mount([ASSET]);
    openAssistant();

    await act(async () => {
      fireEvent.keyDown(document.body, { key: "a" });
    });

    expect(mocks.review).toHaveBeenCalledWith({
      projectId: "p",
      assetId: "a",
      decision: "APPROVED",
      feedback: null,
    });
  });

  it("does not review from a letter typed on one of its own controls", async () => {
    mount([ASSET]);
    openAssistant();

    const send = within(panel()).getAllByRole("button")[0];
    await act(async () => {
      fireEvent.keyDown(send, { key: "a" });
    });

    // The assistant is a conversation about the work, not a verdict on it.
    expect(mocks.review).not.toHaveBeenCalled();
  });
});

describe("state the assistant must not cost", () => {
  it("keeps both drafts across a close and reopen, and sends neither", () => {
    mount();
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "main prompt" },
    });

    openAssistant();
    fireEvent.change(within(panel()).getByRole("textbox"), {
      target: { value: "assistant draft" },
    });
    fireEvent.click(
      within(panel()).getByRole("button", { name: "chatCollapse" }),
    );

    expect(screen.getByRole("textbox")).toHaveValue("main prompt");

    openAssistant();
    expect(within(panel()).getByRole("textbox")).toHaveValue("assistant draft");
  });

  it("cancels the tile it was pressed on, and only that one", async () => {
    mount([], [
      {
        id: "job-1",
        prompt: "first job",
        model: "vendor/model-a",
        status: "RUNNING",
      },
      {
        id: "job-2",
        prompt: "second job",
        model: "vendor/model-a",
        status: "RUNNING",
      },
    ] as unknown as StudioJob[]);

    const tile = screen.getByText("second job").closest("li");
    if (!tile) throw new Error("no tile for the second job");
    await act(async () => {
      fireEvent.click(within(tile).getByRole("button", { name: "cancel" }));
    });

    expect(mocks.cancel).toHaveBeenCalledWith({
      projectId: "p",
      jobId: "job-2",
    });
    expect(
      within(tile).getByRole("button", { name: "cancelRequested" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "cancel" })).toBeEnabled();
  });

  it("keeps two comparison notes apart across the lightbox closing", () => {
    mount([ASSET, { ...ASSET, id: "b", version: 2 }]);

    // A plain string name is matched in full, so this never catches
    // "deselect".
    for (const button of screen.getAllByRole("button", { name: "select" })) {
      fireEvent.click(button);
    }
    fireEvent.click(screen.getByRole("button", { name: "compareSelected" }));

    let dialog = screen.getByRole("dialog");
    let notes = within(dialog).getAllByRole("textbox");
    fireEvent.change(notes[0], { target: { value: "note a" } });
    fireEvent.change(notes[1], { target: { value: "note b" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "close" }));

    expect(screen.getAllByRole("button", { name: "deselect" })).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "compareSelected" }));
    dialog = screen.getByRole("dialog");
    notes = within(dialog).getAllByRole("textbox");
    expect(notes[0]).toHaveValue("note a");
    expect(notes[1]).toHaveValue("note b");
  });
});
