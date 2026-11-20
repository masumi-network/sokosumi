import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import { StudioLightbox } from "./studio-lightbox";
import type { StudioAsset } from "./types";

const { prepareMock, writeCaptionMock, pushMock, toastErrorMock } = vi.hoisted(
  () => ({
    prepareMock: vi.fn(),
    writeCaptionMock: vi.fn(),
    pushMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }),
);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: pushMock }),
  usePathname: () => "/studio",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: () => "today" }),
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock },
}));

vi.mock("@/lib/actions/image-studio/action", () => ({
  requestImageJobCancel: vi.fn(),
  startVideoGeneration: vi.fn(),
  prepareStudioAssetSocialMedia: (...args: unknown[]) => prepareMock(...args),
  writeStudioAssetCaption: (...args: unknown[]) => writeCaptionMock(...args),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
    failed: [],
    queued: [],
    enqueue: vi.fn(),
    waitingForSlot: false,
    lastError: null,
    lastErrorCode: null,
    clearError: vi.fn(),
  }),
}));

vi.mock("./use-studio-state", () => ({
  useStudioState: ({
    initialState,
    initialSelectedAssetId,
  }: {
    initialState: { assets: StudioAsset[] };
    initialSelectedAssetId: string | null;
  }) => {
    const assets =
      initialState.assets.length > 0 ? initialState.assets : [ASSET];
    const selectedId = initialSelectedAssetId ?? assets[0]?.id;
    return {
      state: { assets, jobs: [] },
      selectedAsset: assets.find((asset) => asset.id === selectedId) ?? null,
      selectAsset: vi.fn(),
      activeJobs: [],
      refresh: vi.fn().mockResolvedValue(undefined),
      loadOlder: vi.fn(),
      hasOlder: false,
      error: null,
    };
  },
}));

const MEDIA = {
  pathname: "drive/users/user-1/Content Studio/fox.png",
  fileUrl: "https://store.public.blob.vercel-storage.com/fox.png",
  name: "fox.png",
  size: 12,
  mimeType: "image/png",
  kind: "image" as const,
};

const ASSET: StudioAsset = {
  myThumb: null,
  myReasons: [],
  myComment: null,
  thumbsUp: 0,
  thumbsDown: 0,
  score: 0.5,
  id: "asset-1",
  projectId: "project-9",
  projectName: "Launch",
  rootId: "asset-1",
  parentId: null,
  version: 1,
  prompt: "a red fox",
  model: "vendor/model-a",
  width: 1024,
  height: 1024,
  bytes: 1000,
  contentType: "image/png",
  mediaType: "IMAGE",
  video: null,
  createdAt: new Date("2026-09-26T12:00:00Z"),
  jobId: "job-1",
  settings: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
  contentPath: "/asset-1",
};

function mount(projectLogo?: string) {
  return render(
    <ImageStudio
      catalog={TEST_CATALOG}
      initialSelectedAssetId="asset-1"
      initialState={{ assets: [ASSET], jobs: [], nextCursor: null }}
      labels={TEST_LABELS}
      projectId="project-9"
      projectLogo={projectLogo}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

describe("preview an ad", () => {
  it("downloads the same cropped and branded image shown in the preview", async () => {
    mount(
      "https://abc123.public.blob.vercel-storage.com/projects/project-9/logos/logo.png",
    );
    fireEvent.click(screen.getByRole("button", { name: "previewAd" }));
    const preview = within(screen.getByRole("dialog", { name: "previewAd" }));
    const content = () => preview.getByRole("img", { name: ASSET.prompt });
    const original = content().getAttribute("src");
    const { pathname } = new URL(original ?? "", "https://example.com");
    const logo = preview.getByLabelText("logoOnCreative");

    fireEvent.click(
      preview.getByRole("button", { name: "PreviewPlatforms.reels" }),
    );
    fireEvent.change(logo, { target: { value: "top-right" } });
    const branded = `${pathname}?logo=top-right&placement=9%3A16`;
    expect(content()).toHaveAttribute("src", branded);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1]), {
        headers: { "content-type": "image/png" },
      }),
    );
    const objectUrl = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:https://example.com/placement");
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    try {
      fireEvent.click(
        preview.getByRole("button", { name: "downloadPlacementPng" }),
      );
      await waitFor(() => expect(click).toHaveBeenCalledOnce());
      expect(fetch).toHaveBeenCalledWith(
        `${branded}&download=true`,
        expect.any(Object),
      );
      expect(click.mock.contexts[0]).toHaveAttribute(
        "download",
        "ad-v1-9x16-branded.png",
      );
    } finally {
      fetch.mockRestore();
      click.mockRestore();
      objectUrl.mockRestore();
    }
    fireEvent.change(logo, { target: { value: "" } });
    expect(content()).toHaveAttribute("src", `${pathname}?placement=9%3A16`);
    expect(
      preview.getByRole("button", { name: "downloadPlacementPng" }),
    ).toBeEnabled();
  });

  it("previews a crop of the open image and returns to the same asset", async () => {
    mount();
    const trigger = screen.getByRole("button", { name: "previewAd" });
    fireEvent.click(trigger);

    const preview = screen.getByRole("dialog", { name: "previewAd" });
    expect(within(preview).getByText("Launch")).toBeInTheDocument();
    expect(within(preview).getByText("previewSponsored")).toBeInTheDocument();
    expect(
      within(preview).getByRole("button", { name: /Placements.squareFeed/ }),
    ).toHaveAttribute("aria-pressed", "true");
    const image = within(preview).getByRole("img", { name: ASSET.prompt });
    const src = image.getAttribute("src");
    const path = new URL(src ?? "", "https://example.com").pathname;
    expect(
      within(preview).getByRole("button", {
        name: "PreviewPlatforms.instagram",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(preview).queryByRole("button", {
        name: /Placements.landscapeFeed/,
      }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(preview).getByRole("button", {
        name: "PreviewPlatforms.facebook",
      }),
    );
    fireEvent.click(
      within(preview).getByRole("button", { name: /Placements.landscapeFeed/ }),
    );
    const facebook = within(preview).getByRole("group", {
      name: "PreviewPlatforms.facebook",
    });
    expect(within(facebook).getByRole("img").parentElement).toHaveStyle({
      aspectRatio: "16 / 9",
    });

    fireEvent.click(
      within(preview).getByRole("button", { name: "PreviewPlatforms.reels" }),
    );
    const stories = within(preview).getByRole("button", {
      name: /Placements.stories/,
    });
    expect(stories).toHaveAttribute("aria-pressed", "true");
    const reel = within(preview).getByRole("group", {
      name: "PreviewPlatforms.reels",
    });
    const reelImage = within(reel).getByRole("img");
    expect(reelImage.parentElement).toHaveStyle({ aspectRatio: "9 / 16" });
    expect(reelImage).toHaveAttribute("src", `${path}?placement=9%3A16`);

    fireEvent.click(within(preview).getByRole("button", { name: "close" }));
    await waitFor(() => expect(preview).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });
});

describe("write a caption", () => {
  it("offers caption writing without a beta flag", () => {
    mount();
    expect(
      screen.getByRole("button", { name: "writeCaption" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("captionLabel")).not.toBeInTheDocument();
  });

  it("writes caption text beside the image", async () => {
    writeCaptionMock.mockResolvedValue({
      ok: true,
      value: { text: "Late sun on a red fox." },
    });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));

    await waitFor(() => {
      expect(writeCaptionMock).toHaveBeenCalledWith({
        projectId: "project-9",
        assetId: "asset-1",
      });
    });
    expect(screen.getByLabelText("captionLabel")).toHaveValue(
      "Late sun on a red fox.",
    );
    expect(screen.getByLabelText("captionLabel")).toHaveAttribute(
      "maxLength",
      "500",
    );
  });

  it("keeps the reader on the image when writing fails", async () => {
    writeCaptionMock.mockResolvedValue({
      ok: false,
      error: { code: "INTERNAL_SERVER_ERROR" },
    });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("writeCaptionFailed");
    });
    expect(screen.queryByLabelText("captionLabel")).not.toBeInTheDocument();
  });

  it("carries the edited caption into Social with the image", async () => {
    writeCaptionMock.mockResolvedValue({
      ok: true,
      value: { text: "Late sun on a red fox." },
    });
    prepareMock.mockResolvedValue({ ok: true, value: MEDIA });
    mount();

    fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));
    await waitFor(() => {
      expect(screen.getByLabelText("captionLabel")).toHaveValue(
        "Late sun on a red fox.",
      );
    });

    fireEvent.change(screen.getByLabelText("captionLabel"), {
      target: { value: "The edited caption." },
    });
    fireEvent.click(screen.getByRole("button", { name: "schedule" }));

    await waitFor(() => {
      expect(prepareMock).toHaveBeenCalled();
    });
    expect(
      JSON.parse(sessionStorage.getItem("sokosumi.social-compose.project-9")!),
    ).toEqual({
      media: [MEDIA],
      text: "The edited caption.",
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/social?projectId=project-9&compose=new",
    );
  });

  it("offers a new caption without replacing edits, and lets the reader keep them", async () => {
    writeCaptionMock
      .mockResolvedValueOnce({ ok: true, value: { text: "First caption." } })
      .mockResolvedValueOnce({ ok: true, value: { text: "New caption." } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));
    const caption = await screen.findByLabelText("captionLabel");
    fireEvent.change(caption, { target: { value: "My edited caption." } });
    fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));

    expect(await screen.findByText("New caption.")).toBeVisible();
    expect(caption).toHaveValue("My edited caption.");
    fireEvent.click(screen.getByRole("button", { name: "keepCaption" }));
    expect(caption).toHaveValue("My edited caption.");
    expect(screen.queryByText("New caption.")).not.toBeInTheDocument();
  });

  it("requires a choice to use a replacement and can undo that choice", async () => {
    writeCaptionMock
      .mockResolvedValueOnce({ ok: true, value: { text: "First caption." } })
      .mockResolvedValueOnce({ ok: true, value: { text: "New caption." } });
    mount();
    fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));
    const caption = await screen.findByLabelText("captionLabel");
    fireEvent.change(caption, { target: { value: "My edited caption." } });
    fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));

    fireEvent.click(await screen.findByRole("button", { name: "useCaption" }));
    expect(caption).toHaveValue("New caption.");
    fireEvent.click(screen.getByRole("button", { name: "undoCaption" }));
    expect(caption).toHaveValue("My edited caption.");
  });

  it.each(["Edited while waiting.", ""])(
    "preserves text changed to %j while generation is in flight",
    async (edited) => {
      const pending = Promise.withResolvers<{
        ok: true;
        value: { text: string };
      }>();
      writeCaptionMock
        .mockResolvedValueOnce({ ok: true, value: { text: "First caption." } })
        .mockReturnValueOnce(pending.promise);
      mount();
      fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));
      const caption = await screen.findByLabelText("captionLabel");
      fireEvent.click(screen.getByRole("button", { name: "writeCaption" }));
      fireEvent.change(caption, { target: { value: edited } });

      await act(async () => {
        pending.resolve({ ok: true, value: { text: "Late result." } });
      });

      expect(caption).toHaveValue(edited);
      expect(screen.getByText("Late result.")).toBeVisible();
    },
  );

  it.each(["light", "dark"])(
    "shows and announces caption generation in %s mode",
    async (theme) => {
      document.documentElement.classList.toggle("dark", theme === "dark");
      const pending = Promise.withResolvers<{
        ok: true;
        value: { text: string };
      }>();
      writeCaptionMock.mockReturnValue(pending.promise);
      mount();
      const button = screen.getByRole("button", { name: "writeCaption" });
      expect(screen.getByRole("status")).toBeEmptyDOMElement();

      fireEvent.click(button);
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(screen.getByRole("status")).toHaveTextContent("writingCaption");
      expect(screen.getByText("writingCaption")).toBeVisible();
      fireEvent.click(button);
      expect(writeCaptionMock).toHaveBeenCalledTimes(1);

      await act(async () => {
        pending.resolve({ ok: true, value: { text: "Caption ready." } });
      });
      expect(button).not.toHaveAttribute("aria-busy");
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
      expect(screen.getByLabelText("captionLabel")).toHaveValue(
        "Caption ready.",
      );
    },
  );

  it("offers no caption, regenerate or refine without their handlers (a CMO Project)", () => {
    render(
      <StudioLightbox
        assets={[ASSET]}
        catalog={TEST_CATALOG}
        creditsByAssetId={{}}
        elapsedByAssetId={{}}
        labels={TEST_LABELS}
        onCaptionChange={vi.fn()}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        siblings={[ASSET]}
      />,
    );

    for (const name of ["writeCaption", "regenerate", "refine"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("offers no caption in compare mode", () => {
    const assets = [ASSET, { ...ASSET, id: "asset-2", version: 2 }];
    render(
      <StudioLightbox
        assets={assets}
        caption="A caption for the first image."
        catalog={TEST_CATALOG}
        creditsByAssetId={{}}
        elapsedByAssetId={{}}
        labels={TEST_LABELS}
        onCaptionChange={vi.fn()}
        onClose={vi.fn()}
        onRegenerate={vi.fn()}
        onSelect={vi.fn()}
        onUseAsReference={vi.fn()}
        onWriteCaption={writeCaptionMock}
        siblings={assets}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "writeCaption" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("captionLabel")).not.toBeInTheDocument();
  });
});
