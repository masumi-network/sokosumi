import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ImageStudio } from "./image-studio";
import { TEST_CATALOG, TEST_LABELS } from "./studio-fixtures";
import type { StudioAsset } from "./types";

const { prepareMock, pushMock, toastErrorMock } = vi.hoisted(() => ({
  prepareMock: vi.fn(),
  pushMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

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
  prepareStudioAssetSocialMedia: (...args: unknown[]) => prepareMock(...args),
  writeStudioAssetCaption: vi.fn(),
}));

vi.mock("./use-generation-queue", () => ({
  useGenerationQueue: () => ({
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

const ASSET = {
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
  createdAt: "2026-09-26T12:00:00Z",
  jobId: "job-1",
  settings: {
    aspectRatio: "1:1",
    resolution: "1K",
    outputFormat: "png",
    seed: null,
  },
  contentPath: "/asset-1",
} as unknown as StudioAsset;

function mount(canScheduleSocial = false) {
  return render(
    <ImageStudio
      canScheduleSocial={canScheduleSocial}
      catalog={TEST_CATALOG}
      initialSelectedAssetId="asset-1"
      initialState={{ assets: [ASSET], jobs: [], nextCursor: null } as never}
      labels={TEST_LABELS}
      projectId="project-9"
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

describe("schedule this image", () => {
  it("hides the button when Social is not available", () => {
    mount();
    expect(
      screen.queryByRole("button", { name: "schedule" }),
    ).not.toBeInTheDocument();
  });

  it("opens Social with the image attached", async () => {
    prepareMock.mockResolvedValue({ ok: true, value: MEDIA });
    mount(true);

    fireEvent.click(screen.getByRole("button", { name: "schedule" }));

    await waitFor(() => {
      expect(prepareMock).toHaveBeenCalledWith({
        projectId: "project-9",
        assetId: "asset-1",
      });
    });
    expect(
      JSON.parse(sessionStorage.getItem("sokosumi.social-compose.project-9")!),
    ).toEqual({
      media: [MEDIA],
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/social?projectId=project-9&compose=new",
    );
  });

  it("schedules against the image's project from the workspace gallery", async () => {
    prepareMock.mockResolvedValue({ ok: true, value: MEDIA });
    render(
      <ImageStudio
        canScheduleSocial
        catalog={TEST_CATALOG}
        initialSelectedAssetId="asset-1"
        initialState={{ assets: [ASSET], jobs: [], nextCursor: null } as never}
        labels={TEST_LABELS}
        projectId={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "schedule" }));

    await waitFor(() => {
      expect(prepareMock).toHaveBeenCalledWith({
        projectId: "project-9",
        assetId: "asset-1",
      });
    });
    expect(pushMock).toHaveBeenCalledWith(
      "/social?projectId=project-9&compose=new",
    );
  });

  it("keeps the reader on the image when attach fails", async () => {
    prepareMock.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    mount(true);

    fireEvent.click(screen.getByRole("button", { name: "schedule" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("scheduleFailed");
    });
    expect(pushMock).not.toHaveBeenCalled();
    expect(
      sessionStorage.getItem("sokosumi.social-compose.project-9"),
    ).toBeNull();
  });
});
