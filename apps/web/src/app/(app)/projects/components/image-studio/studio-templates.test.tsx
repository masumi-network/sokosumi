import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { STUDIO_TEMPLATES } from "./studio-templates";
import { requestStudioWebsiteDraftOnOpen } from "./studio-website-intent";
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
  writeStudioAssetCaption: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  assets: [] as unknown[],
  loadBrandKit: vi.fn(),
  saveBrandCopy: vi.fn(),
  uploadLogo: vi.fn(),
  findWebsiteLogo: vi.fn(),
  saveWebsiteLogo: vi.fn(),
  loadWebsiteCopy: vi.fn(),
  startDesignMdGeneration: vi.fn(),
  prepareWebsiteDraft: vi.fn(),
  loadProducts: vi.fn(),
  saveProducts: vi.fn(),
}));

vi.mock("@/lib/actions/image-studio/brand-kit", () => ({
  findStudioWebsiteLogo: mocks.findWebsiteLogo,
  getStudioBrandKit: mocks.loadBrandKit,
  getStudioWebsiteCopy: mocks.loadWebsiteCopy,
  prepareStudioWebsiteDraft: mocks.prepareWebsiteDraft,
  saveStudioBrandCopy: mocks.saveBrandCopy,
  saveStudioWebsiteLogo: mocks.saveWebsiteLogo,
  uploadStudioProjectLogo: mocks.uploadLogo,
}));

vi.mock("@/lib/actions/design-md/action", () => ({
  startDesignMdGeneration: mocks.startDesignMdGeneration,
  pollDesignMdGeneration: vi.fn(),
  finalizeDesignMdGeneration: vi.fn(),
}));

vi.mock("@/lib/actions/image-studio/product-catalog", () => ({
  getStudioProducts: mocks.loadProducts,
  saveStudioProducts: mocks.saveProducts,
  importStudioProducts: vi.fn(),
  attachStudioCatalogPhoto: vi.fn(),
}));

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

function mount(websiteUrl?: string) {
  return render(
    <ImageStudio
      catalog={TEST_CATALOG}
      initialSelectedAssetId={null}
      initialState={{ assets: [], jobs: [], sessions: [] } as never}
      labels={TEST_LABELS}
      projectId="p"
      websiteUrl={websiteUrl}
    />,
  );
}

function pickTemplate(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "templates" }));
  fireEvent.click(screen.getByRole("button", { name }));
}

const STORY_AD = STUDIO_TEMPLATES.find(
  (template) => template.id === "story-ad",
) as (typeof STUDIO_TEMPLATES)[number];

describe("starting from a template", () => {
  it("offers every template, in the order they are declared", () => {
    mount();

    fireEvent.click(screen.getByRole("button", { name: "templates" }));
    const names = STUDIO_TEMPLATES.map((template) => template.id);
    const rendered = names.map(
      (name) => screen.getByRole("button", { name }).textContent,
    );
    expect(rendered).toEqual(names);
  });

  it("opens the brand kit and links to the current project's design in a separate tab", () => {
    mocks.loadBrandKit.mockRejectedValueOnce(new Error("Unavailable"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "brandKit" }));
    const kit = screen.getByRole("link", { name: "brandKitNewTab" });
    expect(kit).toHaveAttribute("href", "/projects/p/design-md");
    expect(kit).toHaveAttribute("target", "_blank");
  });

  it("shows the extracted style and saves reviewed copy for the current project", async () => {
    const version = new Date("2026-11-09T12:00:00.000Z");
    mocks.loadBrandKit.mockResolvedValueOnce({
      logo: null,
      colors: ["#a33421"],
      fonts: ["Inter"],
      summary: "A ceramics studio",
      tone: "Direct",
      audience: ["Home cooks"],
      approvedLines: [],
      version,
    });
    mocks.saveBrandCopy.mockResolvedValueOnce({
      ok: true,
      version: new Date(),
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "brandKit" }));
    expect(await screen.findByText("#a33421")).toBeInTheDocument();
    expect(screen.getByText("Inter")).toBeInTheDocument();
    const copy = screen.getByLabelText("BrandKit.approvedLines");
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.change(copy, {
      target: { value: "Made from reclaimed clay.\n\nFired in Prague." },
    });
    fireEvent.click(screen.getByRole("button", { name: "BrandKit.save" }));
    await screen.findByText("BrandKit.saved");
    expect(mocks.saveBrandCopy).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
      version,
      copy: {
        summary: "A ceramics studio",
        tone: "Direct",
        audience: ["Home cooks"],
        approvedLines: ["Made from reclaimed clay.", "Fired in Prague."],
      },
    });
  });

  it("extracts the project website's visual style without resetting the copy draft", async () => {
    mocks.saveBrandCopy.mockClear();
    mocks.loadBrandKit.mockResolvedValueOnce({
      logo: null,
      colors: ["#a33421"],
      fonts: ["Inter"],
      summary: "A ceramics studio",
      tone: "Direct",
      audience: [],
      approvedLines: [],
      version: null,
    });
    mocks.startDesignMdGeneration.mockResolvedValueOnce({
      ok: true,
      value: {
        kind: "completed",
        data: {
          url: "https://blob.example/design.md",
          extractionId: null,
          previewUrl: null,
          look: {
            colors: ["#285e45"],
            fonts: ["Georgia"],
            tone: "Friendly",
          },
        },
      },
    });
    mount("https://ceramics.example");
    fireEvent.click(screen.getByRole("button", { name: "brandKit" }));
    const tone = await screen.findByLabelText("BrandKit.tone");
    fireEvent.change(tone, { target: { value: "Clear and warm" } });
    const extract = screen.getByRole("button", {
      name: "BrandKit.extractWebsiteStyle",
    });
    fireEvent.click(extract);
    fireEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(mocks.startDesignMdGeneration).not.toHaveBeenCalled();

    fireEvent.click(extract);
    fireEvent.click(screen.getByRole("button", { name: "confirmGenerate" }));
    expect(await screen.findByText("#285e45")).toBeInTheDocument();
    expect(screen.getByText("Georgia")).toBeInTheDocument();
    expect(screen.queryByText("#a33421")).toBeNull();
    expect(tone).toHaveValue("Clear and warm");
    expect(mocks.saveBrandCopy).not.toHaveBeenCalled();
    expect(mocks.startDesignMdGeneration).toHaveBeenCalledExactlyOnceWith({
      force: false,
      owner: { type: "project", projectId: "p" },
      url: "https://ceramics.example",
    });
  });

  it("adds website copy to the draft and only saves after review", async () => {
    mocks.saveBrandCopy.mockClear();
    const version = new Date("2026-11-09T12:00:00.000Z");
    mocks.loadBrandKit.mockResolvedValueOnce({
      logo: null,
      colors: [],
      fonts: [],
      summary: "",
      tone: "Direct",
      audience: ["Home cooks"],
      approvedLines: ["Fired in Prague."],
      version,
    });
    mocks.loadWebsiteCopy.mockResolvedValueOnce({
      summary: "A ceramics studio",
      lines: ["fired in Prague.", "Made from reclaimed clay."],
    });
    mocks.saveBrandCopy.mockResolvedValueOnce({
      ok: true,
      version: new Date(),
    });
    mount("https://ceramics.example");
    fireEvent.click(screen.getByRole("button", { name: "brandKit" }));
    const summary = await screen.findByLabelText("BrandKit.summary");
    const copy = screen.getByLabelText("BrandKit.approvedLines");
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.change(copy, {
      target: { value: "Fired in Prague.\nWheel-thrown." },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "BrandKit.addWebsiteCopy" }),
    );
    await screen.findByText("BrandKit.websiteCopyAdded");
    expect(mocks.loadWebsiteCopy).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
    });
    expect(summary).toHaveValue("A ceramics studio");
    expect(copy).toHaveValue(
      "Fired in Prague.\nWheel-thrown.\nMade from reclaimed clay.",
    );
    expect(mocks.saveBrandCopy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "BrandKit.save" }));
    await screen.findByText("BrandKit.saved");
    expect(mocks.saveBrandCopy).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
      version,
      copy: {
        summary: "A ceramics studio",
        tone: "Direct",
        audience: ["Home cooks"],
        approvedLines: [
          "Fired in Prague.",
          "Wheel-thrown.",
          "Made from reclaimed clay.",
        ],
      },
    });
  });

  it("automatically prepares only the newly created project once and leaves suggestions for review", async () => {
    mocks.prepareWebsiteDraft.mockClear();
    const prepare = Promise.withResolvers();
    mocks.prepareWebsiteDraft.mockReturnValueOnce(prepare.promise);
    requestStudioWebsiteDraftOnOpen("p");

    const studio = mount("https://ceramics.example");
    expect(await screen.findByText("preparing")).toBeInTheDocument();
    expect(mocks.prepareWebsiteDraft).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
    });
    await act(async () =>
      prepare.resolve({
        brandCopy: { summary: "A ceramics studio", lines: [] },
        products: [
          {
            id: "mug",
            name: "Travel mug",
            description: "",
            price: "",
            url: null,
            imageUrl: null,
          },
        ],
      }),
    );

    expect(
      await screen.findByRole("button", { name: "WebsiteDraft.reviewCopy" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "reviewImportedProducts" }),
    ).toBeInTheDocument();
    expect(mocks.saveBrandCopy).not.toHaveBeenCalled();
    expect(mocks.saveProducts).not.toHaveBeenCalled();
    studio.unmount();
    mount("https://ceramics.example");
    expect(mocks.prepareWebsiteDraft).toHaveBeenCalledTimes(1);
  });

  it("prepares website copy and products together for independent review", async () => {
    mocks.saveBrandCopy.mockClear();
    const product = {
      id: "mug",
      name: "Travel mug",
      description: "A reusable mug.",
      price: "$32",
      url: "https://ceramics.example/mug",
      imageUrl: null,
    };
    const secondProduct = {
      ...product,
      id: "vase",
      name: "Clay vase",
      url: "https://ceramics.example/vase",
    };
    mocks.prepareWebsiteDraft.mockResolvedValueOnce({
      brandCopy: {
        summary: "A ceramics studio",
        lines: ["Made from reclaimed clay."],
        tone: "Relaxed",
        audience: ["Ceramics collectors"],
      },
      products: [product, secondProduct],
    });
    mocks.loadBrandKit.mockResolvedValueOnce({
      logo: null,
      colors: [],
      fonts: [],
      summary: "Existing description",
      tone: "Direct",
      audience: ["Home cooks"],
      approvedLines: ["Fired in Prague."],
      version: null,
    });
    mocks.loadProducts.mockResolvedValueOnce({ revision: 4, products: [] });
    mocks.saveProducts.mockResolvedValueOnce({
      revision: 5,
      products: [product, secondProduct],
    });
    mount("https://ceramics.example");
    fireEvent.click(screen.getByRole("button", { name: "prepare" }));
    const brandReview = await screen.findByRole("button", {
      name: "WebsiteDraft.reviewCopy",
    });
    expect(mocks.prepareWebsiteDraft).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
    });
    await waitFor(() => expect(brandReview).toBeEnabled());
    fireEvent.click(brandReview);
    expect(
      await screen.findByText("BrandKit.websiteCopyAdded"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("BrandKit.summary")).toHaveValue(
      "Existing description",
    );
    expect(screen.getByLabelText("BrandKit.approvedLines")).toHaveValue(
      "Fired in Prague.\nMade from reclaimed clay.",
    );
    expect(screen.getByLabelText("BrandKit.tone")).toHaveValue("Direct");
    expect(screen.getByLabelText("BrandKit.audience")).toHaveValue(
      "Home cooks",
    );
    expect(mocks.saveBrandCopy).not.toHaveBeenCalled();
    const close = screen.getByRole("button", { name: "BrandKit.close" });
    await waitFor(() => expect(close).toBeEnabled());
    fireEvent.click(close);

    fireEvent.click(
      await screen.findByRole("button", { name: "reviewImportedProducts" }),
    );
    expect(await screen.findByLabelText("name")).toHaveValue("Travel mug");
    expect(mocks.saveProducts).not.toHaveBeenCalled();
    const save = screen.getByRole("button", { name: "save" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);
    await waitFor(() =>
      expect(mocks.saveProducts).toHaveBeenCalledExactlyOnceWith({
        projectId: "p",
        catalog: { revision: 4, products: [product, secondProduct] },
      }),
    );
    const stage = await screen.findByRole("button", {
      name: "addImportedToBatch",
    });
    await waitFor(() => expect(stage).toBeEnabled());
    fireEvent.click(stage);
    fireEvent.click(screen.getByRole("button", { name: "useBatch" }));
    expect(screen.getByText("Travel mug")).toBeInTheDocument();
    expect(screen.getByText("Clay vase")).toBeInTheDocument();
    expect(mocks.saveProducts).toHaveBeenCalledTimes(1);
  });

  it("puts website voice and audience suggestions into empty draft fields for review", async () => {
    mocks.prepareWebsiteDraft.mockClear();
    mocks.saveBrandCopy.mockClear();
    mocks.prepareWebsiteDraft.mockResolvedValueOnce({
      brandCopy: {
        summary: null,
        lines: [],
        tone: "Warm and relaxed",
        audience: ["Home coffee enthusiasts"],
      },
      products: [],
    });
    mocks.loadBrandKit.mockResolvedValueOnce({
      logo: null,
      colors: [],
      fonts: [],
      summary: "A coffee company",
      tone: "",
      audience: [],
      approvedLines: [],
      version: null,
    });
    mount("https://coffee.example");
    fireEvent.click(screen.getByRole("button", { name: "prepare" }));
    const review = await screen.findByRole("button", {
      name: "WebsiteDraft.reviewCopy",
    });
    await waitFor(() => expect(review).toBeEnabled());
    fireEvent.click(review);
    await screen.findByText("BrandKit.websiteProfileAdded");
    expect(screen.getByLabelText("BrandKit.tone")).toHaveValue(
      "Warm and relaxed",
    );
    expect(screen.getByLabelText("BrandKit.audience")).toHaveValue(
      "Home coffee enthusiasts",
    );
    expect(mocks.saveBrandCopy).not.toHaveBeenCalled();
  });

  it("stages a website logo for approval and preserves unsaved brand copy", async () => {
    mocks.loadBrandKit.mockResolvedValueOnce({
      logo: null,
      colors: [],
      fonts: [],
      summary: "A ceramics studio",
      tone: "Direct",
      audience: [],
      approvedLines: [],
      version: null,
    });
    const logo = "https://blob.example/website-logo.png";
    mocks.findWebsiteLogo.mockResolvedValue({ logo });
    mocks.saveWebsiteLogo.mockResolvedValueOnce({ logo });
    mount("https://ceramics.example");
    fireEvent.click(screen.getByRole("button", { name: "brandKit" }));
    const tone = await screen.findByLabelText("BrandKit.tone");
    await waitFor(() => expect(tone).toBeEnabled());
    fireEvent.change(tone, { target: { value: "Clear and warm" } });
    const findLogo = () =>
      fireEvent.click(
        screen.getByRole("button", { name: "BrandKit.findWebsiteLogo" }),
      );
    findLogo();
    const preview = await screen.findByRole("img", {
      name: "BrandKit.websiteLogoPreview",
    });
    expect(preview).toHaveAttribute("src", logo);
    expect(mocks.findWebsiteLogo).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
    });
    expect(mocks.saveWebsiteLogo).not.toHaveBeenCalled();
    const discard = screen.getByRole("button", {
      name: "BrandKit.discardWebsiteLogo",
    });
    await waitFor(() => expect(discard).toBeEnabled());
    fireEvent.click(discard);
    expect(preview).not.toBeInTheDocument();
    expect(mocks.saveWebsiteLogo).not.toHaveBeenCalled();

    findLogo();
    const approve = await screen.findByRole("button", {
      name: "BrandKit.useWebsiteLogo",
    });
    await waitFor(() => expect(approve).toBeEnabled());
    fireEvent.click(approve);
    await screen.findByText("BrandKit.logoSaved");
    expect(
      screen.getByRole("img", { name: "BrandKit.currentLogo" }),
    ).toHaveAttribute("src", logo);
    expect(tone).toHaveValue("Clear and warm");
    expect(mocks.saveWebsiteLogo).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
      logo,
    });
  });

  it("uploads an approved logo while preserving an unsaved brand copy edit", async () => {
    mocks.loadBrandKit.mockResolvedValueOnce({
      logo: null,
      colors: [],
      fonts: [],
      summary: "A ceramics studio",
      tone: "Direct",
      audience: [],
      approvedLines: [],
      version: null,
    });
    mocks.uploadLogo.mockResolvedValueOnce({
      logo: "https://blob.example/approved.png",
    });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "brandKit" }));
    const copy = await screen.findByLabelText("BrandKit.approvedLines");
    await waitFor(() => expect(copy).toBeEnabled());
    fireEvent.change(copy, { target: { value: "Fired in Prague." } });

    const picker = screen.getByLabelText("BrandKit.logoFile");
    fireEvent.change(picker, {
      target: {
        files: [new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" })],
      },
    });
    expect(screen.getByText("BrandKit.logoFileInvalid")).toBeInTheDocument();
    expect(mocks.uploadLogo).not.toHaveBeenCalled();

    const file = new File(["PNG data"], "approved.png", { type: "image/png" });
    fireEvent.change(picker, { target: { files: [file] } });
    await screen.findByText("BrandKit.logoSaved");
    expect(mocks.uploadLogo).toHaveBeenCalledExactlyOnceWith({
      projectId: "p",
      file,
    });
    expect(
      screen.getByRole("button", { name: "BrandKit.replaceLogo" }),
    ).toBeInTheDocument();
    expect(copy).toHaveValue("Fired in Prague.");
  });

  it("fills the composer with the template's brief and sets its frame", () => {
    mount();

    // The default target is 1:1 (see `defaultModel` and the initial settings),
    // and only one selected model supports the story frame of 9:16.
    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();

    pickTemplate("story-ad");

    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    expect(prompt).toHaveValue(STORY_AD.prompt);
    expect(screen.getByText("mixedSettings")).toBeInTheDocument();
  });

  it("does not submit, and leaves the caret in the prompt", () => {
    mount();

    pickTemplate("social-post");

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
    pickTemplate("story-ad");
    expect(prompt).toHaveValue(STORY_AD.prompt);
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
    pickTemplate("story-ad");
    expect(
      screen.getByRole("button", { name: "undoTemplate" }),
    ).toBeInTheDocument();
    fireEvent.change(prompt, { target: { value: "Edited story brief" } });
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
    pickTemplate("social-post");
    fireEvent.keyDown(prompt, { key: "Enter", ctrlKey: true });
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
  });

  it("keeps the original typed brief through several template choices", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "Original brief" } });
    pickTemplate("story-ad");
    pickTemplate("social-post");
    fireEvent.click(screen.getByRole("button", { name: "undoTemplate" }));
    expect(prompt).toHaveValue("Original brief");
    expect(screen.getByText("1:1 · 1K · png")).toBeInTheDocument();
  });

  it("expires template undo when the frame changes away and back", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "Original brief" } });
    pickTemplate("social-post");
    fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
    fireEvent.click(screen.getByRole("button", { name: "16:9" }));
    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    expect(prompt).toHaveValue(
      STUDIO_TEMPLATES.find((template) => template.id === "social-post")
        ?.prompt,
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
    pickTemplate("story-ad");
    fireEvent.click(screen.getByRole("button", { name: /moreOptions/ }));
    fireEvent.click(screen.getByRole("button", { name: "2" }));
    expect(
      screen.queryByRole("button", { name: "undoTemplate" }),
    ).not.toBeInTheDocument();
  });
});

describe("creative starting points", () => {
  it("offers nine options and applies an editable brief through the existing undo flow", () => {
    mount();
    const prompt = screen.getByRole("textbox", { name: "promptPlaceholder" });
    fireEvent.change(prompt, { target: { value: "My own brief" } });
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    const dialog = screen.getByRole("dialog", { name: "title" });
    expect(within(dialog).getAllByRole("button")).toHaveLength(10);
    fireEvent.click(screen.getByRole("button", { name: "video" }));
    expect(prompt).toHaveProperty(
      "value",
      expect.stringContaining("Create a storyboard"),
    );
    fireEvent.click(screen.getByRole("button", { name: "undoTemplate" }));
    expect(prompt).toHaveValue("My own brief");
    fireEvent.click(screen.getByRole("button", { name: "open" }));
    fireEvent.click(screen.getByRole("button", { name: "other" }));
    expect(prompt).toHaveValue("My own brief");
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
    fireEvent.click(screen.getByRole("button", { name: "story-ad" }));

    expect(
      screen.queryByRole("dialog", { name: "templates" }),
    ).not.toBeInTheDocument();
    expect(prompt).toHaveValue(STORY_AD.prompt);
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
