import type {
  ProjectImageStudioTalkingVideoCatalog,
  ProjectTalkingVideos,
} from "@sokosumi/core-client";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SearchablePageContent } from "@/components/searchable-page-content";
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
  useFormatter: () => ({ number: (value: number) => String(value) }),
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
        cutoutPerSecondUsd: 0.01,
        brollUsd: 0.5,
        musicUsd: 0.1,
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
      voice: "Sarah",
    },
    {
      id: "jonas",
      name: "Jonas",
      description: "",
      imageUrl: "https://example.com/jonas.jpg",
      voice: "Brian",
    },
  ],
  defaultVoice: "Sarah",
  voices: ["Sarah", "Brian"],
  scriptMinLength: 20,
  scriptMaxLength: 600,
};

const SCRIPT = "We roast every bag in Zurich the week it ships.";

function renderStudio({ hasWebsite = false } = {}) {
  render(
    <TestQueryProvider>
      <TikTokStudio
        catalog={CATALOG}
        initialVideos={{ jobs: [], assets: [] }}
        hasWebsite={hasWebsite}
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

  it("offers to show the website only when the project has one", async () => {
    startTalkingVideoMock.mockResolvedValue({ ok: false, message: "no" });
    renderStudio();
    expect(screen.queryByLabelText("showSite")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() =>
      expect(startTalkingVideoMock).toHaveBeenCalledWith(
        expect.objectContaining({ siteShots: false }),
      ),
    );
  });

  it("shows the website unless the person turns it off", async () => {
    startTalkingVideoMock.mockResolvedValue({ ok: false, message: "no" });
    renderStudio({ hasWebsite: true });
    expect(screen.getByLabelText("showSite")).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() =>
      expect(startTalkingVideoMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ siteShots: true }),
      ),
    );

    fireEvent.click(screen.getByLabelText("showSite"));
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() =>
      expect(startTalkingVideoMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ siteShots: false }),
      ),
    );
  });

  it("adds music and an opening clip only when they are ticked", async () => {
    startTalkingVideoMock.mockResolvedValue({ ok: false, message: "no" });
    renderStudio();
    fireEvent.click(screen.getByLabelText("addMusic"));
    fireEvent.click(screen.getByLabelText("addBroll"));
    fireEvent.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() =>
      expect(startTalkingVideoMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ music: true, broll: true }),
      ),
    );
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
    await screen.findByLabelText("consent");

    expect(screen.getByText("consentMissing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "create" })).toBeDisabled();

    fireEvent.click(screen.getByLabelText("consent"));
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
            hasWebsite={false}
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
    fireEvent.click(screen.getByRole("button", { name: /videoReady/ }));
    fireEvent.click(screen.getByRole("button", { name: "postToTikTok" }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(
      "tik-account launch.mp4",
    );
    expect(prepareStudioAssetSocialMedia).toHaveBeenCalledWith({
      projectId: "project-1",
      assetId: "asset-1",
    });
  });

  it("pulses a presenter's tile until their photo has loaded", () => {
    // happy-dom treats every image as already loaded; a browser does not.
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(false);
    renderStudio();
    complete.mockRestore();
    const tile = screen.getByRole("radio", { name: "Maya" });
    const photo = tile.querySelector("img");
    if (!photo) throw new Error("Maya has no photo");

    expect(tile.querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(photo).toHaveClass("opacity-0");

    fireEvent.load(photo);

    expect(tile.querySelector('[data-slot="skeleton"]')).toBeNull();
    expect(photo).toHaveClass("opacity-100");
  });

  it("speaks with the chosen presenter's own voice", async () => {
    startTalkingVideoMock.mockResolvedValue({ ok: false, message: "no" });
    renderStudio();

    fireEvent.click(screen.getByRole("radio", { name: "Jonas" }));
    fireEvent.click(screen.getByRole("button", { name: "create" }));

    await waitFor(() =>
      expect(startTalkingVideoMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          presenter: { kind: "stock", id: "jonas" },
          voice: "Brian",
        }),
      ),
    );
  });

  it("scrolls to a chosen video once the stage shows it", () => {
    // On a phone the stage moves to the top when it shows a video, so a
    // scroll made before that render lands where the stage used to be.
    const scrolledTo: (string | null)[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolledTo.push(this.getAttribute("aria-label"));
    });
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
          hasWebsite={false}
        />
      </TestQueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /videoFailed/ }));

    expect(scrolledTo).toEqual(["stageVideo"]);
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
                talkingVideo: { presenterId: "jonas", voice: "Brian" },
              } as ProjectTalkingVideos["jobs"][number],
            ],
            assets: [],
          }}
          projectId="project-1"
          readOnly={false}
          hasWebsite={false}
        />
      </TestQueryProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /videoFailed/ }));
    fireEvent.click(screen.getByRole("button", { name: "reuseScript" }));

    expect(screen.getByLabelText("script")).toHaveValue(SCRIPT);
    expect(screen.getByRole("radio", { name: "Jonas" })).toBeChecked();
    expect(screen.getByRole("combobox", { name: "voice" })).toHaveTextContent(
      "Brian",
    );
    expect(screen.getByRole("region", { name: "preview" })).toBeInTheDocument();
  });

  describe("a finished video", () => {
    const job = (id: string, status: string, prompt = `${SCRIPT} ${id}`) =>
      ({
        id,
        status,
        prompt,
        createdAt: new Date(),
      }) as ProjectTalkingVideos["jobs"][number];
    const asset = (jobId: string) =>
      ({
        id: `asset-${jobId}`,
        jobId,
        contentPath: `/${jobId}.mp4`,
      }) as ProjectTalkingVideos["assets"][number];

    function renderLibrary(
      jobs = [job("a", "SUCCEEDED"), job("b", "SUCCEEDED")],
      assets = [asset("a"), asset("b")],
      { readOnly = false } = {},
    ) {
      render(
        <TestQueryProvider>
          <TikTokStudio
            catalog={CATALOG}
            initialVideos={{ jobs, assets }}
            hasWebsite={false}
            projectId="project-1"
            readOnly={readOnly}
          />
        </TestQueryProvider>,
      );
    }
    it("searches earlier video pages and restores the recent library when cleared", async () => {
      const recent = Array.from({ length: 30 }, (_, index) =>
        job(`recent-${index}`, "SUCCEEDED"),
      );
      const older = job("older", "SUCCEEDED", "Archived espresso recipe");
      const fetchVideos = vi.fn(async (url: string) =>
        Response.json(
          url.includes("beforeId=recent-29")
            ? { jobs: [older], assets: [asset("older")], hasMore: false }
            : url.includes("beforeId=")
              ? { jobs: [], assets: [] }
              : { jobs: recent, assets: [], hasMore: true },
        ),
      );
      vi.stubGlobal("fetch", fetchVideos);
      render(
        <TestQueryProvider>
          <SearchablePageContent>
            <TikTokStudio
              catalog={CATALOG}
              initialVideos={{ jobs: recent, assets: [], hasMore: true }}
              hasWebsite={false}
              projectId="project-1"
              readOnly
            />
          </SearchablePageContent>
        </TestQueryProvider>,
      );
      expect(
        screen.queryByRole("button", { name: /Archived espresso/ }),
      ).toBeNull();
      const historyCalls = () =>
        fetchVideos.mock.calls.filter(([url]) => url.includes("beforeId="));
      expect(historyCalls()).toHaveLength(0);
      const field = screen.getByRole("searchbox");
      fireEvent.change(field, { target: { value: "espresso" } });
      fireEvent.click(
        await screen.findByRole("button", { name: /Archived espresso/ }),
      );
      expect(
        screen.getByLabelText("Archived espresso recipe", {
          selector: "video",
        }),
      ).toBeInTheDocument();
      fireEvent.change(field, { target: { value: "" } });
      expect(
        screen.queryByRole("button", { name: /Archived espresso/ }),
      ).toBeNull();
      expect(
        screen.getByLabelText("Archived espresso recipe", {
          selector: "video",
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /recent-29$/ }),
      ).toBeInTheDocument();
      expect(historyCalls()).toHaveLength(1);
    });

    it("reconciles a selected older video through playback without reloading terminal history", {
      timeout: 12_000,
    }, async () => {
      const recent = {
        jobs: [job("recent", "SUCCEEDED")],
        assets: [],
        hasMore: true,
      };
      const script = "Archived espresso lesson";
      let readActive = false;
      let settled = false;
      let terminalPageReads = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => {
          const before = new URL(url, "http://localhost").searchParams.get(
            "beforeId",
          );
          if (before === "recent") {
            terminalPageReads++;
            return Response.json({
              jobs: [job("terminal", "FAILED")],
              assets: [],
              hasMore: true,
            });
          }
          if (before === "terminal") {
            readActive = true;
            return Response.json({
              jobs: [job("active", settled ? "SUCCEEDED" : "RUNNING", script)],
              assets: settled ? [asset("active")] : [],
              hasMore: false,
            });
          }
          if (readActive) {
            settled = true;
            return Response.json({
              ...recent,
              jobs: [job("new-anchor", "SUCCEEDED")],
            });
          }
          return Response.json(recent);
        }),
      );
      render(
        <TestQueryProvider>
          <SearchablePageContent>
            <TikTokStudio
              catalog={CATALOG}
              initialVideos={recent}
              hasWebsite={false}
              projectId="project-1"
              readOnly
            />
          </SearchablePageContent>
        </TestQueryProvider>,
      );
      const field = screen.getByRole("searchbox");
      fireEvent.change(field, { target: { value: "espresso" } });
      fireEvent.click(
        await screen.findByRole("button", {
          name: /videoMaking.*Archived espresso/,
        }),
      );
      fireEvent.change(field, { target: { value: "" } });
      expect(
        await screen.findByLabelText(
          script,
          { selector: "video" },
          { timeout: 6500 },
        ),
      ).toBeInTheDocument();
      expect(terminalPageReads).toBe(1);
    });

    it("cancels the pending history request when the search is cleared", async () => {
      const recent = {
        jobs: [job("latest", "SUCCEEDED")],
        assets: [],
        hasMore: true,
      };
      let historySignal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string, options: RequestInit) => {
          if (!url.includes("beforeId="))
            return Promise.resolve(Response.json(recent));
          const signal = options.signal!;
          historySignal = signal;
          return new Promise<Response>((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), {
              once: true,
            });
          });
        }),
      );
      render(
        <TestQueryProvider>
          <SearchablePageContent>
            <TikTokStudio
              catalog={CATALOG}
              initialVideos={recent}
              hasWebsite={false}
              projectId="project-1"
              readOnly
            />
          </SearchablePageContent>
        </TestQueryProvider>,
      );
      const field = screen.getByRole("searchbox");
      fireEvent.change(field, { target: { value: "earlier" } });
      await waitFor(() => expect(historySignal?.aborted).toBe(false));
      fireEvent.change(field, { target: { value: "" } });
      await waitFor(() => expect(historySignal?.aborted).toBe(true));
    });

    const stageVideo = (id: string) =>
      screen.getByLabelText(`${SCRIPT} ${id}`, { selector: "video" });
    const tile = (id: string) =>
      screen.getByRole("button", { name: new RegExp(`${SCRIPT} ${id}$`) });
    const tileVideo = (id: string) => {
      const video = tile(id).querySelector("video");
      if (!video) throw new Error(`tile ${id} has no video`);
      return video;
    };
    const stage = () => screen.getByRole("region", { name: "stageVideo" });
    const actionsOff = () => {
      expect(screen.getByRole("button", { name: "download" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "post" })).toBeDisabled();
    };
    const actionsOn = () => {
      expect(screen.getByRole("link", { name: "download" })).toHaveAttribute(
        "download",
      );
      expect(screen.getByRole("button", { name: "post" })).toBeEnabled();
    };

    it("offers Download and Post without waiting for the file to preload", () => {
      // Phones that skip preload send no media event until play is pressed.
      renderLibrary();
      fireEvent.click(tile("a"));
      actionsOn();
    });

    it("says when its file does not load and turns Download and Post off", () => {
      renderLibrary();
      fireEvent.click(tile("a"));
      fireEvent.error(stageVideo("a"));

      expect(screen.getByRole("alert")).toHaveTextContent("loadFailed");
      actionsOff();
      expect(tile("a")).toHaveAccessibleName(/videoUnavailable/);
    });

    it("keeps actions off after Try again until the video can really play", () => {
      renderLibrary();
      fireEvent.click(tile("a"));
      fireEvent.error(stageVideo("a"));
      fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));

      // Focus stays on the stage, where the player came back.
      expect(stage()).toContainElement(document.activeElement as HTMLElement);
      expect(document.activeElement).not.toBe(document.body);
      expect(stage()).toHaveTextContent("checking");
      actionsOff();

      // Not playable yet, so the library does not call it Ready.
      expect(tile("a")).toHaveAccessibleName(/videoUnavailable/);

      // Size and length alone are not a playable file.
      fireEvent.loadedMetadata(stageVideo("a"));
      actionsOff();

      fireEvent.canPlay(stageVideo("a"));
      actionsOn();
      expect(stage()).not.toHaveTextContent("checking");
      expect(tile("a")).toHaveAccessibleName(/videoReady/);
    });

    it("hands focus back to Try again when the retry fails too", () => {
      renderLibrary();
      fireEvent.click(tile("a"));
      fireEvent.error(stageVideo("a"));
      fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
      fireEvent.error(stageVideo("a"));

      expect(screen.getByRole("button", { name: "tryAgain" })).toHaveFocus();
      actionsOff();
    });

    it("leaves focus where the person moved it when a retry fails late", () => {
      renderLibrary();
      fireEvent.click(tile("a"));
      fireEvent.error(stageVideo("a"));
      fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
      const script = screen.getByLabelText("script");
      script.focus();
      fireEvent.error(stageVideo("a"));

      expect(script).toHaveFocus();
      expect(
        screen.getByRole("button", { name: "tryAgain" }),
      ).not.toHaveFocus();
    });

    it("keeps a confirmed failure, and its gate, across video switches", () => {
      renderLibrary();
      fireEvent.click(tile("a"));
      fireEvent.error(stageVideo("a"));
      fireEvent.click(screen.getByRole("button", { name: "tryAgain" }));
      fireEvent.click(tile("b"));

      expect(stage()).not.toHaveTextContent("checking");
      actionsOn();

      fireEvent.click(tile("a"));
      expect(stage()).toHaveTextContent("checking");
      actionsOff();
    });

    it("never lets a thumbnail tear down a stage that plays", () => {
      renderLibrary();
      fireEvent.click(tile("a"));
      fireEvent.canPlay(stageVideo("a"));
      fireEvent.error(tileVideo("a"));

      expect(stageVideo("a")).toBeInTheDocument();
      actionsOn();
      expect(tile("a")).toHaveAccessibleName(/videoReady/);
    });

    it("marks a thumbnail Unavailable without touching the video on stage", () => {
      renderLibrary();
      fireEvent.click(tile("b"));
      fireEvent.error(tileVideo("a"));

      expect(tile("a")).toHaveAccessibleName(/videoUnavailable/);
      expect(stageVideo("b")).toBeInTheDocument();
      actionsOn();

      // Opening it tries the file itself rather than trusting the thumbnail.
      fireEvent.click(tile("a"));
      expect(stageVideo("a")).toBeInTheDocument();
    });

    it("marks a thumbnail that failed before the page came alive", () => {
      // A fast 404 can land before hydration, so its error event is gone.
      const error = vi
        .spyOn(HTMLMediaElement.prototype, "error", "get")
        .mockReturnValue({ code: 4 } as MediaError);
      try {
        renderLibrary();
      } finally {
        error.mockRestore();
      }
      expect(tile("a")).toHaveAccessibleName(/videoUnavailable/);
    });

    it("shows a returning owner their videos and states before the form", () => {
      const scrolledTo: (string | null)[] = [];
      Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
        scrolledTo.push(this.getAttribute("aria-label"));
      });
      renderLibrary(
        [job("a", "SUCCEEDED"), job("m", "RUNNING"), job("f", "FAILED")],
        [asset("a")],
      );

      const library = screen.getByRole("region", { name: "videos" });
      const form = screen.getByRole("form", { name: "formLabel" });
      // The video being made is on the stage.
      const preview = stage();
      const follows = (a: Element, b: Element) =>
        Boolean(
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING,
        );
      // Keyboard order: videos, then the stage beside them, then the form.
      expect(follows(library, preview)).toBe(true);
      expect(follows(preview, form)).toBe(true);
      expect(library).toHaveTextContent("3");
      expect(tile("a")).toHaveAccessibleName(/videoReady/);
      expect(tile("m")).toHaveAccessibleName(/videoMaking · \d+:\d{2}/);
      expect(tile("f")).toHaveAccessibleName(/videoFailed/);

      fireEvent.click(tile("a"));
      fireEvent.click(
        within(library).getByRole("button", { name: "newVideo" }),
      );

      expect(screen.getByRole("region", { name: "preview" })).toBeVisible();
      expect(scrolledTo.at(-1)).toBe("formLabel");
      expect(form).toHaveFocus();

      fireEvent.click(tile("a"));
      fireEvent.click(
        within(stage()).getByRole("button", { name: "newVideo" }),
      );
      expect(form).toHaveFocus();
    });

    it("lets a read-only project leave a video without a New video form", () => {
      renderLibrary(undefined, undefined, { readOnly: true });
      const library = screen.getByRole("region", { name: "videos" });
      expect(
        within(library).queryByRole("button", { name: "newVideo" }),
      ).not.toBeInTheDocument();

      fireEvent.click(tile("a"));
      fireEvent.click(
        within(stage()).getByRole("button", { name: "newVideo" }),
      );

      expect(screen.getByRole("region", { name: "preview" })).toBeVisible();
      expect(screen.getByRole("form", { name: "formLabel" })).not.toHaveFocus();
    });

    it("starts a first-time owner on the form, with no library", () => {
      renderStudio();
      expect(
        screen.queryByRole("region", { name: "videos" }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole("form", { name: "formLabel" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "newVideo" }),
      ).not.toBeInTheDocument();
    });
  });
});
