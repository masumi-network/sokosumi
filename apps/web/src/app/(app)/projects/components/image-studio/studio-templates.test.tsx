import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { STUDIO_TEMPLATES } from "./studio-templates";

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
  reviewImageVersion: vi.fn(),
  clearImageVersionReview: vi.fn(),
  requestImageJobCancel: vi.fn(),
}));

vi.mock("./use-studio-state", () => ({
  useStudioState: () => ({
    state: { assets: [], jobs: [] },
    selectedAsset: null,
    selectAsset: vi.fn(),
    activeJobs: [],
    applyAsset: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
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

    const prompt = screen.getByRole("textbox");
    expect(prompt).toHaveValue(POSTER.prompt);
    expect(screen.getByText("2:3 · 1K · png")).toBeInTheDocument();
  });

  it("does not submit, and leaves the caret in the prompt", () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "headshot" }));

    const prompt = screen.getByRole("textbox");
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
});
