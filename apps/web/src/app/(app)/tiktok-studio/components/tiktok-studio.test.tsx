import type { ProjectImageStudioTalkingVideoCatalog } from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TestQueryProvider } from "@/test/query-provider";

const { startTalkingVideoMock, writeScriptsMock, uploadDriveFileMock } =
  vi.hoisted(() => ({
    startTalkingVideoMock: vi.fn(),
    writeScriptsMock: vi.fn(),
    uploadDriveFileMock: vi.fn(),
  }));

vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("@/lib/actions/image-studio/action", () => ({
  startTalkingVideo: startTalkingVideoMock,
  writeTalkingVideoScripts: writeScriptsMock,
}));
vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: async () => ({
      data: { session: { activeOrganizationId: "org-1" } },
    }),
  },
}));
vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: uploadDriveFileMock,
  isDriveFileUploadDuplicate: () => false,
}));
vi.mock("@/lib/utils/drive-file-list.client", () => ({
  driveStoreForActiveWorkspace: () => "org",
}));

import { TikTokStudio } from "./tiktok-studio";

const CATALOG: ProjectImageStudioTalkingVideoCatalog = {
  defaultModelId: "talk-a",
  models: [
    {
      id: "talk-a",
      label: "Talk A",
      description: "",
      endpoint: "vendor/talk-a",
      price: {
        perSecondUsd: 0.181,
        minimumVideoUsd: 1.1,
        voicePer1000CharactersUsd: 0.08,
        captionsPerMinuteUsd: 0.03,
        basis: "",
        sourceUrl: "",
        verifiedAt: "2026-11-18",
      },
    },
  ],
  presenters: [
    {
      id: "maya",
      name: "Maya",
      description: "",
      imageUrl: "https://example.com/maya.jpg",
    },
  ],
  defaultVoice: "Sarah",
  voices: ["Sarah", "Brian"],
  scriptMinLength: 20,
  scriptMaxLength: 600,
};

const SCRIPT = "We roast every bag in Zurich the week it ships.";

function renderStudio() {
  render(
    <TestQueryProvider>
      <TikTokStudio
        catalog={CATALOG}
        initialVideos={{ jobs: [], assets: [] }}
        projectId="project-1"
        readOnly={false}
      />
    </TestQueryProvider>,
  );
  fireEvent.change(screen.getByLabelText("script"), {
    target: { value: SCRIPT },
  });
}

beforeEach(() => {
  startTalkingVideoMock.mockReset();
  uploadDriveFileMock.mockReset();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x" }));
  // A started video is polled; answer with nothing new.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ jobs: [], assets: [] })),
  );
});

describe("TikTokStudio", () => {
  it("quotes the script before rendering and starts a stock presenter's video", async () => {
    startTalkingVideoMock.mockResolvedValue({
      ok: true,
      job: { id: "job-1", status: "QUEUED", prompt: SCRIPT },
    });
    renderStudio();

    // 4 s quoted, so the $1.10 minimum plus voice and captions.
    expect(screen.getByText("creditsCount")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() =>
      expect(startTalkingVideoMock).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "project-1",
          modelId: "talk-a",
          script: SCRIPT,
          voice: "Sarah",
          presenter: { kind: "stock", id: "maya" },
        }),
      ),
    );
  });

  it("refuses the person's own photo until they confirm consent", async () => {
    uploadDriveFileMock.mockResolvedValue({ resourceId: "file-1" });
    renderStudio();

    const input = screen.getByLabelText("ownPhoto", { selector: "input" });
    fireEvent.change(input, {
      target: {
        files: [new File(["x"], "me.jpg", { type: "image/jpeg" })],
      },
    });
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: "create" }));

    expect(await screen.findByText("consentMissing")).toBeInTheDocument();
    expect(startTalkingVideoMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    startTalkingVideoMock.mockResolvedValue({
      ok: true,
      job: { id: "job-2", status: "QUEUED", prompt: SCRIPT },
    });
    fireEvent.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() =>
      expect(startTalkingVideoMock).toHaveBeenCalledWith(
        expect.objectContaining({
          presenter: { kind: "file", fileId: "file-1", consent: true },
        }),
      ),
    );
  });

  it("names a script that speaks as a customer beside the script", async () => {
    startTalkingVideoMock.mockResolvedValue({
      ok: false,
      kind: "talking_video_testimonial",
      message: "",
      uncertain: false,
    });
    renderStudio();

    fireEvent.click(screen.getByRole("button", { name: "create" }));

    expect(await screen.findByText("testimonial")).toBeInTheDocument();
  });
});
