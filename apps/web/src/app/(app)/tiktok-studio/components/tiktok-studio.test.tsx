import type {
  ProjectImageStudioTalkingVideoCatalog,
  ProjectTalkingVideos,
} from "@sokosumi/core-client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SocialProviderAvailabilityProvider } from "@/contexts/social-provider-availability-context";
import { prepareStudioAssetSocialMedia } from "@/lib/actions/image-studio/action";
import { coreClient } from "@/lib/clients/core.browser.client";
import { TestQueryProvider } from "@/test/query-provider";

const { startTalkingVideoMock, writeScriptsMock, uploadDriveFileMock } =
  vi.hoisted(() => ({
    startTalkingVideoMock: vi.fn(),
    writeScriptsMock: vi.fn(),
    uploadDriveFileMock: vi.fn(),
  }));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: { getProjectsByIdSocialConnections: vi.fn() },
}));
vi.mock(
  "@/app/projects/components/social-posts/social-post-composer-dialog",
  () => ({
    SocialPostComposerDialog: ({
      mode,
      connections,
    }: {
      mode: { media: { name: string }[] };
      connections: { id: string }[];
    }) => (
      <div role="dialog">
        {connections.map((account) => account.id).join(",")}{" "}
        {mode.media[0].name}
      </div>
    ),
  }),
);
vi.mock("next-intl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next-intl")>()),
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/actions/image-studio/action", () => ({
  prepareStudioAssetSocialMedia: vi.fn(),
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
        perSecondUsd: 0.05,
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
  Element.prototype.scrollIntoView = vi.fn();
  // A started video is polled; answer with nothing new.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ jobs: [], assets: [] })),
  );
});

describe("TikTokStudio", () => {
  it("shows the cost before the button and puts the started video on the stage", async () => {
    startTalkingVideoMock.mockResolvedValue({
      ok: true,
      job: {
        id: "job-1",
        status: "QUEUED",
        prompt: SCRIPT,
        createdAt: new Date(),
      },
    });
    renderStudio();

    // 4 s quoted: 20 cents of video plus voice and captions.
    expect(screen.getByText("creditsCount")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "preview" })).toHaveTextContent(
      SCRIPT,
    );
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
    expect(
      await screen.findByRole("region", { name: "stageVideo" }),
    ).toHaveTextContent("starting");
  });

  it("says what is missing instead of a cost, and keeps the button off", () => {
    renderStudio();
    fireEvent.change(screen.getByLabelText("script"), {
      target: { value: "Too short" },
    });

    expect(screen.getByText("needScript")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "create" })).toBeDisabled();
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

    expect(screen.getByText("consentMissing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "create" })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox"));
    startTalkingVideoMock.mockResolvedValue({
      ok: true,
      job: {
        id: "job-2",
        status: "QUEUED",
        prompt: SCRIPT,
        createdAt: new Date(),
      },
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

  it("opens the selected finished video in the project's TikTok composer", async () => {
    const video = {
      name: "launch.mp4",
      kind: "video",
      mimeType: "video/mp4",
      size: 24,
      pathname: "drive/launch.mp4",
      fileUrl: "https://example.com/launch.mp4",
    } as const;
    vi.mocked(prepareStudioAssetSocialMedia).mockResolvedValue({
      ok: true,
      value: video,
    });
    vi.mocked(coreClient.getProjectsByIdSocialConnections).mockResolvedValue({
      data: [
        { id: "tik-account", provider: "tiktok" },
        { id: "x-account", provider: "x" },
      ],
    } as Awaited<
      ReturnType<typeof coreClient.getProjectsByIdSocialConnections>
    >);
    render(
      <TestQueryProvider>
        <SocialProviderAvailabilityProvider enabledProviders={["tiktok", "x"]}>
          <TikTokStudio
            catalog={CATALOG}
            projectId="project-1"
            readOnly={false}
            initialVideos={{
              jobs: [
                {
                  id: "job-1",
                  prompt: SCRIPT,
                  status: "SUCCEEDED",
                } as ProjectTalkingVideos["jobs"][number],
              ],
              assets: [
                {
                  id: "asset-1",
                  jobId: "job-1",
                  contentPath: "/launch.mp4",
                } as ProjectTalkingVideos["assets"][number],
              ],
            }}
          />
        </SocialProviderAvailabilityProvider>
      </TestQueryProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: SCRIPT }));
    fireEvent.click(screen.getByRole("button", { name: "postToTikTok" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "tik-account launch.mp4",
    );
    expect(prepareStudioAssetSocialMedia).toHaveBeenCalledWith({
      projectId: "project-1",
      assetId: "asset-1",
    });
  });

  it("offers a failed video's script again", () => {
    render(
      <TestQueryProvider>
        <TikTokStudio
          catalog={CATALOG}
          initialVideos={{
            jobs: [
              {
                id: "job-9",
                status: "FAILED",
                prompt: SCRIPT,
                createdAt: new Date(),
              } as ProjectTalkingVideos["jobs"][number],
            ],
            assets: [],
          }}
          projectId="project-1"
          readOnly={false}
        />
      </TestQueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /videoFailed/ }));
    fireEvent.click(screen.getByRole("button", { name: "reuseScript" }));

    expect(screen.getByLabelText("script")).toHaveValue(SCRIPT);
    expect(screen.getByRole("region", { name: "preview" })).toBeInTheDocument();
  });
});
