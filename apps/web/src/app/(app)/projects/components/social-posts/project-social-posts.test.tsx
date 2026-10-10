import type {
  ProjectSocialConnection,
  SocialPost,
  SocialPostMediaRef,
} from "@sokosumi/core-client";
import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  act,
  fireEvent,
  render as renderUi,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import {
  SocialComposeProvider,
  useSocialCompose,
} from "@/app/social/components/social-compose-context";
import {
  cancelProjectSocialPost,
  createProjectSocialPost,
  publishProjectSocialPost,
  refreshProjectSocialPostStatistics,
  scheduleProjectSocialPost,
  updateProjectSocialPost,
} from "@/lib/actions/project/action";
import { createTestFormatter } from "@/test/intl-formatter";
import { TestQueryProvider } from "@/test/query-provider";

import { loadMoreSocialPosts } from "./actions";

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdSocialConnections: (...args: unknown[]) =>
      getSocialConnectionsMock(...args),
  },
}));

vi.mock("./actions", () => ({
  loadMoreSocialPosts: vi.fn(),
}));

const {
  pushMock,
  refreshMock,
  toastErrorMock,
  toastSuccessMock,
  uploadDriveFileMock,
  drivePickerFile,
  drivePickerVideoFile,
  getSocialConnectionsMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadDriveFileMock: vi.fn(),
  getSocialConnectionsMock: vi.fn(),
  drivePickerFile: {
    name: "launch.png",
    fileUrl:
      "https://store.public.blob.vercel-storage.com/drive/users/user_1/launch.png",
    pathname: "drive/users/user_1/launch.png",
    size: 2048,
    uploadedAt: new Date("2026-09-14T10:00:00.000Z"),
  },
  drivePickerVideoFile: {
    name: "clip.mp4",
    fileUrl:
      "https://store.public.blob.vercel-storage.com/drive/users/user_1/clip.mp4",
    pathname: "drive/users/user_1/clip.mp4",
    size: 4096,
    uploadedAt: new Date("2026-09-14T10:00:00.000Z"),
  },
}));

const MESSAGES: Record<string, string> = {
  title: "Social posts",
  loadMore: "Load more",
  loading: "Loading…",
  description: "Draft text posts for X and schedule them from this Project.",
  newPost: "New post",
  moreActions: "Post actions",
  noAccount: "No account",
  needsReconnect: "Account needs reconnecting",
  needsReconnectLink: "Reconnect the account",
  viewPost: "View post",
  publishedAt: "Published {date}",
  failedAt: "Failed {date}",
  attempts: "{count} attempts",
  "actions.publishNow": "Publish now",
  "actions.retry": "Retry",
  "filters.platform": "Platform",
  "sections.calendar": "Calendar",
  "sections.drafts": "Drafts",
  "sections.attention": "Needs attention",
  "sections.accounts": "Accounts",
  "sections.statistics": "Statistics",
  "statistics.refresh": "Refresh statistics",
  "statistics.refreshFailed":
    "Failed to refresh statistics. Previous results are retained.",
  "connectPrompt.title": "Connect an account to start posting",
  "connectPrompt.body": "Posts go out from this project's accounts.",
  "connectPrompt.action": "Connect X, YouTube, LinkedIn…",
  selectedPost: "Selected post",
  "empty.drafts": "No drafts yet.",
  "emptyHint.drafts": "Save a post as a draft to finish it later.",
  "status.DRAFT": "Draft",
  "status.SCHEDULED": "Scheduled",
  "status.PUBLISHING": "Publishing…",
  "status.PUBLISHED": "Published",
  "status.FAILED": "Failed",
  "status.MISSED": "Missed",
  "status.CANCELED": "Canceled",
  "creator.user": "User",
  "creator.coworker": "Coworker",
  "creator.sokoBot": "Soko Bot",
  "composer.newTitle": "New post",
  "composer.editTitle": "Edit post",
  "composer.scheduleTitle": "Schedule post",
  "composer.rescheduleTitle": "Reschedule post",
  "composer.description":
    "Write the text, pick the account, and choose when it goes out.",
  "composer.text": "Text",
  "composer.textPlaceholder": "What do you want to post?",
  "composer.characters": "{count} / {limit}",
  "composer.media.addFromDrive": "Add from Drive",
  "composer.media.upload": "Upload",
  "composer.media.remove": "Remove {name}",
  "composer.media.hint": "Up to 4 images, or one GIF, or one video.",
  "composer.media.unsupported": "Use a JPG, PNG, WebP, GIF, or MP4 file.",
  "composer.media.alreadyAttached": "That file is already attached.",
  "composer.media.uploadDuplicate":
    "A file with this name already exists in the Drive. Rename it and try again.",
  "composer.media.uploadFailed": "The upload failed. Try again.",
  "composer.media.errors.too_many_images":
    "X allows at most 4 images per post.",
  "composer.media.errors.too_many_gifs": "X allows one GIF per post.",
  "composer.media.errors.too_many_videos": "X allows one video per post.",
  "composer.media.errors.mixed_media":
    "Use images, one GIF, or one video — not a mix.",
  "composer.media.errors.unsupported_type":
    "Use a JPG, PNG, WebP, GIF, or MP4 file.",
  "composer.media.errors.too_large": "A file is too large for X.",
  "composer.account": "Account",
  "composer.accounts": "Post to",
  "composer.publishNow": "Post now",
  "toasts.publishedMany": "Post published.",
  "composer.platforms": "Limits per platform",
  "composer.platformLimit": "{provider} {format} · {count} / {limit}",
  "composer.formats.post": "post",
  "composer.formats.mediaPost": "image or video post",
  "composer.formats.video": "video",
  "composer.accountOption": "{provider} {handle}",
  "composer.noAccounts": "No accounts connected yet.",
  "composer.unknownHandle": "Unknown X account",
  "composer.scheduledAt": "Scheduled time",
  "composer.saveDraft": "Save draft",
  "composer.save": "Save",
  "composer.schedule": "Schedule",
  "composer.reschedule": "Reschedule",
  "composer.cancel": "Cancel post",
  "composer.edit": "Edit",
  "composer.close": "Close",
  "composer.dismiss": "Cancel",
  "composer.when": "When",
  "composer.scheduleFor": "Schedule for {date}",
  "composer.rescheduleFor": "Reschedule for {date}",
  "composer.connectAccount": "Connect account",
  "composer.previewEmpty": "Your post shows here as you write.",
  now: "Now",
  "cancelDialog.title": "Cancel this post?",
  "cancelDialog.description":
    "The post will not be published. This cannot be undone.",
  "cancelDialog.confirm": "Cancel post",
  "publishDialog.title": "Publish this post now?",
  "publishDialog.description":
    "The post goes out to X right away instead of waiting for its scheduled time.",
  "publishDialog.confirm": "Publish now",
  "toasts.published": "Post published.",
  "toasts.publishFailed": "Publishing failed: {error}",
  "toasts.created": "Draft saved.",
  "toasts.scheduled": "Post scheduled.",
  "toasts.updated": "Post updated.",
  "toasts.canceled": "Post canceled.",
  "toasts.conflict":
    "This post was changed elsewhere. Reloading the latest version.",
  "toasts.failed": "Something went wrong. Try again.",
  "composer.scheduledAtTooSoon": "Choose a time at least one minute from now.",
  "composer.timezone.yours": "Times are in your time zone, {zone}.",
  "composer.timezone.goesOut": "Goes out {date}, your time ({zone}).",
  "composer.timezone.postZone": "Scheduled as {date} in {zone}.",
  quickPicks: "Quick picks",
  "quick.inAnHour": "In an hour ({time})",
  "quick.tomorrowMorning": "Tomorrow {time}",
  "quick.nextMonday": "Monday {time}",
  pickDate: "Pick a date",
  pickTime: "Pick a time",
  dateSelected: "Date: {date}",
  timeSelected: "Time: {time}",
  times: "Times",
  "toasts.unauthenticated": "Please log in to continue.",
  "toasts.unauthenticatedAction": "Log in",
  "preview.open": "Preview",
  "preview.dialogTitle": "Post preview",
  "outcomes.authorizationRevoked":
    "Coworker scheduling access was revoked. Reschedule this post to publish it.",
};

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    useFormatter: () => createTestFormatter(),
    useTranslations:
      () => (key: string, values?: Record<string, string | number>) => {
        const message = MESSAGES[key] ?? key;
        if (!values) return message;
        return Object.entries(values).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          message,
        );
      },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => toastErrorMock(...args),
    success: (...args: unknown[]) => toastSuccessMock(...args),
  },
}));

vi.mock("@/lib/actions/project/action", () => ({
  cancelProjectSocialPost: vi.fn(),
  createProjectSocialPost: vi.fn(),
  publishProjectSocialPost: vi.fn(),
  refreshProjectSocialPostStatistics: vi.fn(),
  scheduleProjectSocialPost: vi.fn(),
  updateProjectSocialPost: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: {
      user: { id: "user-1" },
      session: { activeOrganizationId: "org_1" },
    },
  }),
}));

vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: (...args: unknown[]) => uploadDriveFileMock(...args),
}));

vi.mock("@/components/drive/drive-file-picker", () => ({
  DriveFilePicker: ({
    open,
    onSelect,
  }: {
    open: boolean;
    onSelect: (file: unknown) => void;
  }) =>
    open ? (
      <div data-testid="drive-file-picker-stub">
        <button
          type="button"
          onClick={() => onSelect(drivePickerFile)}
        >{`pick ${drivePickerFile.name}`}</button>
        <button
          type="button"
          onClick={() => onSelect(drivePickerVideoFile)}
        >{`pick ${drivePickerVideoFile.name}`}</button>
      </div>
    ) : null,
}));

const PROJECT_ID = "project-1";

function buildConnection(
  overrides: Partial<ProjectSocialConnection> = {},
): ProjectSocialConnection {
  return {
    id: "connection-1",
    provider: "x",
    externalHandle: "sokosumi",
    displayName: null,
    avatarUrl: null,
    status: "active",
    connectedAt: new Date("2026-09-03T10:00:00.000Z"),
    disconnectedAt: null,
    ...overrides,
  };
}

function buildPost(overrides: Partial<SocialPost> = {}): SocialPost {
  return {
    id: "post-draft",
    projectId: PROJECT_ID,
    provider: "x",
    text: "Draft text",
    media: [],
    status: "DRAFT",
    scheduledAt: null,
    timezone: null,
    socialConnection: null,
    creator: { kind: "user", id: "user-1", name: "Alice" },
    scheduledByUserId: null,
    canceledAt: null,
    publishedAt: null,
    publishedExternalId: null,
    publishedUrl: null,
    lastError: null,
    attemptCount: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    lastAttempt: null,
    revision: 0,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-01T10:00:00.000Z"),
    canEdit: true,
    canSchedule: true,
    canCancel: false,
    canPublishNow: true,
    connectionNeedsReconnect: false,
    ...overrides,
  };
}

const SCHEDULED_POST = buildPost({
  id: "post-scheduled",
  text: "Scheduled text",
  status: "SCHEDULED",
  scheduledAt: new Date("2026-10-01T10:00:00.000Z"),
  timezone: "UTC",
  socialConnection: {
    id: "connection-1",
    externalHandle: "sokosumi",
    displayName: null,
    avatarUrl: null,
    status: "active",
  },
  creator: { kind: "coworker", id: "coworker-1", name: "Scout" },
  revision: 2,
  canEdit: true,
  canSchedule: true,
  canCancel: true,
});

const PUBLISHED_POST = buildPost({
  id: "post-published",
  text: "Published text",
  status: "PUBLISHED",
  publishedAt: new Date("2026-08-01T10:00:00.000Z"),
  publishedExternalId: "1234567890",
  publishedUrl: "https://x.com/sokosumi/status/1234567890",
  attemptCount: 1,
  lastAttemptAt: new Date("2026-08-01T10:00:00.000Z"),
  lastAttempt: {
    attempt: 1,
    trigger: "scheduler",
    outcome: "succeeded",
    errorKind: null,
    providerOutcome: "201 created",
    finishedAt: new Date("2026-08-01T10:00:00.000Z"),
  },
  creator: { kind: "sokoBot", id: "bot-1", name: null },
  canEdit: false,
  canSchedule: false,
  canCancel: false,
  canPublishNow: false,
});

const FAILED_POST = buildPost({
  id: "post-failed",
  text: "Failed text",
  status: "FAILED",
  scheduledAt: new Date("2026-09-10T10:00:00.000Z"),
  timezone: "UTC",
  socialConnection: {
    id: "connection-1",
    externalHandle: "sokosumi",
    displayName: null,
    avatarUrl: null,
    status: "active",
  },
  lastError: "X rejected the post (403 forbidden)",
  attemptCount: 3,
  lastAttemptAt: new Date("2026-09-10T10:05:00.000Z"),
  lastAttempt: {
    attempt: 3,
    trigger: "scheduler",
    outcome: "failed_permanent",
    errorKind: "provider_rejected",
    providerOutcome: "403 forbidden",
    finishedAt: new Date("2026-09-10T10:05:00.000Z"),
  },
  revision: 5,
  canEdit: false,
  canSchedule: true,
  canCancel: false,
  canPublishNow: true,
});

const PUBLISHING_POST = buildPost({
  id: "post-publishing",
  text: "Publishing text",
  status: "PUBLISHING",
  scheduledAt: new Date("2026-09-15T09:00:00.000Z"),
  timezone: "UTC",
  socialConnection: {
    id: "connection-1",
    externalHandle: "sokosumi",
    displayName: null,
    avatarUrl: null,
    status: "active",
  },
  attemptCount: 1,
  lastAttemptAt: new Date("2026-09-15T09:00:00.000Z"),
  canEdit: false,
  canSchedule: false,
  canCancel: false,
  canPublishNow: false,
});

const IMAGE_REF: SocialPostMediaRef = {
  pathname: "drive/users/user_1/launch.png",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/launch.png",
  name: "launch.png",
  size: 2048,
  mimeType: "image/png",
  kind: "image",
};

/** A fixed local "now" for the schedule picker, and its "In an hour" slot. */
const NOW = new Date(2026, 8, 20, 10, 3);
const IN_AN_HOUR = new Date(2026, 8, 20, 11, 15);

function freezeClock(now: Date = NOW) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
}

async function pickInAnHour(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
) {
  await user.click(within(dialog).getByRole("button", { name: /^In an hour/ }));
}

async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  postId: string,
) {
  const row = screen.getByTestId(`social-post-${postId}`);
  await user.click(within(row).getByRole("button", { name: "Post actions" }));
}

/** Tabs carry a count after the label, so match on how the name starts. */
function getTab(label: string) {
  return screen.getByRole("tab", { name: new RegExp(`^${label}`) });
}

async function openTab(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
) {
  await user.click(getTab(label));
}

// Social's top-level New post menu stands in as a plain button here; it opens
// the composer through the same context.
function NewPostButton() {
  const compose = useSocialCompose();
  return (
    <button type="button" onClick={() => compose?.setOpen(true)}>
      New post
    </button>
  );
}

function ComposeHarness({ children }: { children: React.ReactNode }) {
  return (
    <TestQueryProvider>
      <NuqsTestingAdapter>
        <SocialComposeProvider>
          <NewPostButton />
          {children}
        </SocialComposeProvider>
      </NuqsTestingAdapter>
    </TestQueryProvider>
  );
}

function render(ui: React.ReactElement) {
  return renderUi(ui, { wrapper: ComposeHarness });
}

describe("ProjectSocialPosts", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    getSocialConnectionsMock.mockRejectedValue(
      new Error("photo lookup unavailable"),
    );
    vi.mocked(createProjectSocialPost).mockResolvedValue({
      ok: true,
      value: buildPost({ id: "post-new", text: "Fresh" }),
    });
    vi.mocked(updateProjectSocialPost).mockResolvedValue({
      ok: true,
      value: buildPost({ text: "Edited", revision: 1 }),
    });
    vi.mocked(scheduleProjectSocialPost).mockResolvedValue({
      ok: true,
      value: SCHEDULED_POST,
    });
    vi.mocked(cancelProjectSocialPost).mockResolvedValue({
      ok: true,
      value: { ...SCHEDULED_POST, status: "CANCELED", revision: 3 },
    });
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: { ...PUBLISHED_POST, id: "post-draft", text: "Draft text" },
    });
  });

  it("lists drafts in a tab and leaves scheduled and published posts to the calendar", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost(), SCHEDULED_POST, PUBLISHED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Drafts 1",
      "Statistics ",
    ]);
    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");

    const drafts = screen.getByTestId("social-posts-section-drafts");
    const draftRow = within(drafts).getByTestId("social-post-post-draft");
    expect(within(draftRow).getByText("Draft text")).toBeVisible();
    expect(within(draftRow).getByText("No account")).toBeVisible();
    expect(within(draftRow).getByText("User · Alice")).toBeVisible();
    // Every card leads with its status, the way a task card does.
    expect(
      within(draftRow).getByTestId("social-post-status-DRAFT"),
    ).toHaveTextContent("Draft");

    expect(
      screen.queryByTestId("social-post-post-scheduled"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("social-post-post-published"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  it("narrows the draft list by platform and keeps the full tab count", () => {
    renderUi(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost(),
          buildPost({
            id: "post-li",
            provider: "linkedin",
            text: "LinkedIn draft",
          }),
        ]}
        projectId={PROJECT_ID}
      />,
      {
        wrapper: ({ children }) => (
          <TestQueryProvider>
            <NuqsTestingAdapter searchParams="?tab=drafts&provider=linkedin">
              <SocialComposeProvider>{children}</SocialComposeProvider>
            </NuqsTestingAdapter>
          </TestQueryProvider>
        ),
      },
    );

    const drafts = screen.getByTestId("social-posts-section-drafts");
    expect(within(drafts).getByText("LinkedIn draft")).toBeVisible();
    expect(
      within(drafts).queryByTestId("social-post-post-draft"),
    ).not.toBeInTheDocument();
    expect(getTab("Drafts")).toHaveTextContent("Drafts 2");
    expect(screen.getByTestId("social-posts-platform-filter")).toBeVisible();
  });

  it("hides the platform filter on the calendar tab", () => {
    render(
      <ProjectSocialPosts
        calendar={<p>Calendar panel</p>}
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
      />,
    );

    expect(
      screen.queryByTestId("social-posts-platform-filter"),
    ).not.toBeInTheDocument();
  });

  it("opens Social on its calendar, with Accounts as the last tab", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        actions={<button type="button">Page action</button>}
        calendar={<p>Calendar panel</p>}
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Calendar ",
      "Drafts 1",
      "Statistics ",
      "Accounts 1",
    ]);
    expect(screen.getByText("Calendar panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "Page action" })).toBeVisible();

    await openTab(user, "Accounts");
    expect(screen.getByText("Accounts panel")).toBeVisible();
    expect(screen.queryByText("Calendar panel")).not.toBeInTheDocument();
  });

  it("opens a linked draft preview without changing the calendar tab", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        calendar={<p>Calendar panel</p>}
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
        selectedPostId="post-draft"
      />,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    expect(getTab("Calendar")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Calendar panel")).toBeVisible();
  });

  it("leads with connecting an account while the project has none", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        calendar={<p>Calendar panel</p>}
        connections={[]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    const prompt = screen.getByTestId("social-connect-prompt");
    expect(
      within(prompt).getByText("Connect an account to start posting"),
    ).toBeVisible();
    await user.click(
      within(prompt).getByRole("button", {
        name: "Connect X, YouTube, LinkedIn…",
      }),
    );

    expect(getTab("Accounts")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Accounts panel")).toBeVisible();
    expect(
      screen.queryByTestId("social-connect-prompt"),
    ).not.toBeInTheDocument();
  });

  it("counts connected accounts on the Accounts tab and drops the prompt", () => {
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        calendar={<p>Calendar panel</p>}
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Accounts")).toHaveTextContent("Accounts 1");
    expect(
      screen.queryByTestId("social-connect-prompt"),
    ).not.toBeInTheDocument();
  });

  it("opens the tab the URL names", () => {
    renderUi(
      <NuqsTestingAdapter searchParams="?tab=drafts">
        <SocialComposeProvider>
          <ProjectSocialPosts
            accounts={<p>Accounts panel</p>}
            calendar={<p>Calendar panel</p>}
            connections={[buildConnection()]}
            posts={[buildPost()]}
            projectId={PROJECT_ID}
          />
        </SocialComposeProvider>
      </NuqsTestingAdapter>,
    );

    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("social-post-post-draft")).toBeVisible();
  });

  it("opens a linked scheduled post in a dialog without a Selected post section", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        calendar={<p>Calendar panel</p>}
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );
    expect(
      within(screen.getByRole("dialog")).getByText("Scheduled text"),
    ).toBeVisible();
    expect(
      screen.queryByTestId("social-posts-selected"),
    ).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(getTab("Calendar")).toHaveAttribute("aria-selected", "true");
  });

  it("tells an empty tab how it fills", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    const drafts = screen.getByTestId("social-posts-section-drafts");
    expect(within(drafts).getByText("No drafts yet.")).toBeVisible();
    expect(
      within(drafts).getByText("Save a post as a draft to finish it later."),
    ).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: /^Needs attention/ }),
    ).not.toBeInTheDocument();
  });

  it("opens the composer when Social links here with ?compose=new", () => {
    renderUi(
      <TestQueryProvider>
        <NuqsTestingAdapter searchParams="?compose=new">
          <SocialComposeProvider>
            <ProjectSocialPosts
              connections={[buildConnection()]}
              posts={[]}
              projectId={PROJECT_ID}
            />
          </SocialComposeProvider>
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );

    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "New post",
      }),
    ).toBeInTheDocument();
  });

  it("opens the composer from New post and blocks over-limit text", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "New post" }),
    ).toBeVisible();

    const saveDraft = within(dialog).getByRole("button", {
      name: "Save draft",
    });
    expect(saveDraft).toBeDisabled();

    const textarea = within(dialog).getByLabelText("Text");
    fireEvent.change(textarea, { target: { value: "x".repeat(281) } });
    expect(screen.getByTestId("social-post-character-count")).toHaveTextContent(
      "281 / 280",
    );
    expect(
      screen.getByTestId("social-post-character-count").className,
    ).toContain("text-destructive");
    expect(saveDraft).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Post now" }),
    ).toBeDisabled();

    await user.type(textarea, "{backspace}");
    expect(screen.getByTestId("social-post-character-count")).toHaveTextContent(
      "280 / 280",
    );
    expect(saveDraft).toBeEnabled();
  });

  it("shows where the post goes at the top of the composer", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const accounts = within(dialog).getByRole("group", { name: "Post to" });
    // Before the text: the reader picks where it goes first.
    expect(
      accounts.compareDocumentPosition(within(dialog).getByLabelText("Text")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(accounts).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(accounts).getByRole("button", {
        name: "LinkedIn @sokosumi-co",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("counts the text against each picked platform's own limit", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "a".repeat(300) },
    });

    const x = within(dialog).getByTestId("social-post-platform-x");
    const linkedIn = within(dialog).getByTestId(
      "social-post-platform-linkedin",
    );
    expect(x).toHaveTextContent("X post · 300 / 280");
    expect(x).toHaveClass("text-destructive");
    expect(linkedIn).toHaveTextContent("LinkedIn post · 300 / 3000");
    expect(linkedIn).not.toHaveClass("text-destructive");
    // One text goes to both, so the stricter limit blocks saving.
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeDisabled();
  });

  it("posts to X in one go: open, type, Post now", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost).mockResolvedValue({
      ok: true,
      value: buildPost({ id: "post-now", text: "Shipping today", revision: 0 }),
    });
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: { ...PUBLISHED_POST, id: "post-now", text: "Shipping today" },
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    // The account is picked already, so typing starts in the text.
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Text")).toHaveFocus(),
    );
    await user.keyboard("Shipping today");
    const postNow = within(dialog).getByRole("button", { name: "Post now" });
    await user.click(postNow);

    await waitFor(() => {
      expect(publishProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-now",
        revision: 0,
      });
    });
    expect(createProjectSocialPost).toHaveBeenCalledWith(
      expect.objectContaining({
        socialConnectionId: "connection-1",
        text: "Shipping today",
      }),
    );
    expect(createProjectSocialPost).not.toHaveBeenCalledWith(
      expect.objectContaining({ scheduledAt: expect.anything() }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith("Post published.");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("keeps a post that fails to publish now, with the reason", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost).mockResolvedValue({
      ok: true,
      value: buildPost({ id: "post-now", text: "Hi", revision: 0 }),
    });
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: {
        ...FAILED_POST,
        id: "post-now",
        lastError: "X rejected the post",
      },
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Hi");
    await user.click(within(dialog).getByRole("button", { name: "Post now" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Publishing failed: X rejected the post",
      );
    });
    expect(getTab("Needs attention")).toHaveAttribute("aria-selected", "true");
  });

  it("never saves a new draft with ⌘Enter in the schedule dialog", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost({ socialConnection: null })]}
        projectId={PROJECT_ID}
      />,
    );

    await openRowMenu(user, "post-draft");
    await user.click(screen.getByRole("menuitem", { name: "Schedule" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(
      within(dialog).getByRole("heading", { name: "Schedule post" }),
      { key: "Enter", metaKey: true },
    );

    // No time yet, so nothing happens; it never falls back to Save draft.
    expect(createProjectSocialPost).not.toHaveBeenCalled();
    expect(scheduleProjectSocialPost).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("posts again only to the accounts a Post now missed", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost)
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({ id: "post-x", text: "Hi", revision: 0 }),
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "BAD_INPUT", message: "LinkedIn refused it" },
      });
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: { ...PUBLISHED_POST, id: "post-x", text: "Hi" },
    });
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    );
    await user.type(within(dialog).getByLabelText("Text"), "Hi");
    await user.click(within(dialog).getByRole("button", { name: "Post now" }));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("LinkedIn refused it");
    });
    // X is live already, so it leaves the selection.
    expect(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("posts now with ⌘Enter, and schedules with it once a time is picked", async () => {
    freezeClock();
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost).mockResolvedValue({
      ok: true,
      value: SCHEDULED_POST,
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Later");
    await pickInAnHour(user, dialog);
    fireEvent.keyDown(within(dialog).getByLabelText("Text"), {
      key: "Enter",
      metaKey: true,
    });

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({ scheduledAt: IN_AN_HOUR.toISOString() }),
      );
    });
    expect(publishProjectSocialPost).not.toHaveBeenCalled();
  });

  it("retries only the accounts that failed after a partial save", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost)
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({ id: "post-x", text: "Hello" }),
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "BAD_INPUT", message: "LinkedIn refused it" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({
          id: "post-li",
          provider: "linkedin",
          text: "Hello",
        }),
      });
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    );
    await user.type(within(dialog).getByLabelText("Text"), "Hello");
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("LinkedIn refused it");
    });
    // X is saved already, so it leaves the selection; LinkedIn stays.
    expect(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );
    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledTimes(3);
    });
    expect(createProjectSocialPost).toHaveBeenLastCalledWith(
      expect.objectContaining({ socialConnectionId: "connection-2" }),
    );
  });

  it("saves one draft per account picked", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost)
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({ id: "post-x", text: "Hello" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({
          id: "post-li",
          provider: "linkedin",
          text: "Hello",
        }),
      });
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    );
    await user.type(within(dialog).getByLabelText("Text"), "Hello");
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledTimes(2);
    });
    expect(createProjectSocialPost).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ socialConnectionId: "connection-1" }),
    );
    expect(createProjectSocialPost).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ socialConnectionId: "connection-2" }),
    );
    expect(screen.getByTestId("social-post-post-x")).toBeVisible();
    expect(screen.getByTestId("social-post-post-li")).toBeVisible();
  });

  it("keeps Schedule disabled without an account or a future time", async () => {
    freezeClock();
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts connections={[]} posts={[]} projectId={PROJECT_ID} />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Hello world");

    // With nowhere to post, saving a draft is the main action.
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
    expect(
      within(dialog).queryByRole("button", { name: "Post now" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "Now" }),
    ).not.toBeInTheDocument();

    await pickInAnHour(user, dialog);
    expect(
      within(dialog).getByRole("button", { name: /^Schedule for / }),
    ).toBeDisabled();
  });

  it("offers to connect an account when the project has none", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        connections={[]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Connect account",
      }),
    );

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(getTab("Accounts")).toHaveAttribute("aria-selected", "true");
  });

  it("names the scheduled time on the main button", async () => {
    freezeClock();
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Hello");
    await pickInAnHour(user, dialog);
    expect(
      within(dialog).queryByRole("button", { name: "Post now" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^Schedule for / }),
    ).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: "Now" }));
    expect(
      within(dialog).getByRole("button", { name: "Post now" }),
    ).toBeEnabled();
  });

  it("saves a draft through the create action and lists it", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Fresh");
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        text: "Fresh",
        media: [],
        socialConnectionId: "connection-1",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Draft saved.");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // The list follows the new draft to its tab.
    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");
    expect(
      within(screen.getByTestId("social-post-post-new")).getByText("Fresh"),
    ).toBeVisible();
  });

  it("returns focus to the calendar trigger after closing a preview", async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button" data-testid="preview-trigger">
          Calendar post
        </button>
        <ProjectSocialPosts
          connections={[buildConnection()]}
          posts={[SCHEDULED_POST]}
          projectId={PROJECT_ID}
          selectedPostId="post-scheduled"
          previewOnly
          returnFocus={() => screen.getByTestId("preview-trigger").focus()}
        />
      </>,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByTestId("preview-trigger")).toHaveFocus(),
    );
  });

  it("retries fetching missing account photos when opening New post", async () => {
    const user = userEvent.setup();
    getSocialConnectionsMock.mockResolvedValue({
      data: [buildConnection({ avatarUrl: "https://example.com/photo.png" })],
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );
    expect(getSocialConnectionsMock).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "New post" }));
    await waitFor(() =>
      expect(getSocialConnectionsMock).toHaveBeenCalledWith(PROJECT_ID),
    );
    expect(
      within(screen.getByRole("dialog")).getByTestId("social-post-accounts"),
    ).toBeVisible();
  });

  it("renders media thumbnails in a linked post preview", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[{ ...SCHEDULED_POST, id: "post-media", media: [IMAGE_REF] }]}
        projectId={PROJECT_ID}
        selectedPostId="post-media"
      />,
    );

    expect(
      within(screen.getByRole("dialog")).getByAltText("launch.png"),
    ).toBeVisible();
  });

  it("attaches a Drive file and sends it with the draft", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "With media");
    await user.click(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    );
    await user.click(screen.getByRole("button", { name: "pick launch.png" }));
    expect(within(dialog).getByTestId("social-post-media")).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: PROJECT_ID,
          text: "With media",
          media: [
            expect.objectContaining({
              pathname: "drive/users/user_1/launch.png",
              mimeType: "image/png",
              kind: "image",
            }),
          ],
        }),
      );
    });
  });

  it("allows saving a post that has media and no text", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const saveDraft = within(dialog).getByRole("button", {
      name: "Save draft",
    });
    expect(saveDraft).toBeDisabled();

    await user.click(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    );
    await user.click(screen.getByRole("button", { name: "pick launch.png" }));
    expect(saveDraft).toBeEnabled();

    await user.click(saveDraft);
    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({ text: "" }),
      );
    });
  });

  it("rejects mixing media kinds with a clear message", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    );
    await user.click(screen.getByRole("button", { name: "pick launch.png" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    );
    await user.click(screen.getByRole("button", { name: "pick clip.mp4" }));

    expect(toastErrorMock).toHaveBeenCalledWith(
      "Use images, one GIF, or one video — not a mix.",
    );
    expect(within(dialog).queryByText("clip.mp4")).not.toBeInTheDocument();
    expect(
      within(dialog).getByTestId("social-post-media").querySelectorAll("img"),
    ).toHaveLength(1);
  });

  it("uploads a file into the Drive and attaches it", async () => {
    const user = userEvent.setup();
    uploadDriveFileMock.mockResolvedValue({
      pathname: "drive/users/user_1/new-shot.png",
      fileUrl:
        "https://store.public.blob.vercel-storage.com/drive/users/user_1/new-shot.png",
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const input = dialog.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const file = new File(["x"], "new-shot.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);

    await act(async () => {
      fireEvent.change(input as HTMLInputElement, {
        target: { files: dataTransfer.files },
      });
    });

    await waitFor(() => {
      expect(uploadDriveFileMock).toHaveBeenCalledWith(file, {
        scope: "org",
        organizationId: "org_1",
      });
    });
    expect(within(dialog).getByTestId("social-post-media")).toBeVisible();
  });

  it("schedules a new post with an ISO timestamp and the viewer timezone", async () => {
    freezeClock();
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost).mockResolvedValue({
      ok: true,
      value: SCHEDULED_POST,
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Scheduled text");
    await pickInAnHour(user, dialog);
    const schedule = within(dialog).getByRole("button", { name: /^Schedule/ });
    await waitFor(() => expect(schedule).toBeEnabled());
    await user.click(schedule);

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        text: "Scheduled text",
        media: [],
        socialConnectionId: "connection-1",
        scheduledAt: IN_AN_HOUR.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post scheduled.");
    // A scheduled post lives on the calendar, not in the drafts list.
    expect(
      screen.getByTestId("social-posts-section-drafts"),
    ).not.toHaveTextContent("Scheduled text");
  });

  it("prefills the editor and sends the observed revision", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost({ revision: 4 })]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Drafts");
    await openRowMenu(user, "post-draft");
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    const textarea = within(dialog).getByLabelText("Text");
    expect(textarea).toHaveValue("Draft text");
    await user.clear(textarea);
    await user.type(textarea, "Edited");
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() => {
      expect(updateProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-draft",
        text: "Edited",
        media: [],
        socialConnectionId: "connection-1",
        revision: 4,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post updated.");
    expect(
      within(screen.getByTestId("social-post-post-draft")).getByText("Edited"),
    ).toBeVisible();
  });

  it("previews a post as it will look on X and reschedules from there", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          {
            ...SCHEDULED_POST,
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: "Sokosumi HQ",
              avatarUrl: null,
              status: "active",
            },
          },
        ]}
        projectId={PROJECT_ID}
        // A scheduled post lives on the calendar; a calendar link names it.
        selectedPostId="post-scheduled"
      />,
    );

    const dialog = screen.getByRole("dialog");
    const preview = within(dialog).getByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "x");
    expect(within(preview).getByText("Sokosumi HQ")).toBeVisible();
    expect(within(preview).getByText("Scheduled text")).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", { name: /^Reschedule/ }),
    );

    expect(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: "Reschedule post",
      }),
    ).toBeVisible();
  });

  it("reschedules a scheduled post from the row menu", async () => {
    freezeClock();
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    await openRowMenu(user, "post-scheduled");
    await user.click(screen.getByRole("menuitem", { name: "Reschedule" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Reschedule post" }),
    ).toBeVisible();
    expect(within(dialog).queryByLabelText("Text")).not.toBeInTheDocument();
    await pickInAnHour(user, dialog);
    await user.click(
      within(dialog).getByRole("button", { name: /^Reschedule/ }),
    );

    await waitFor(() => {
      expect(scheduleProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-scheduled",
        scheduledAt: IN_AN_HOUR.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        socialConnectionId: "connection-1",
        revision: 2,
      });
    });
    expect(updateProjectSocialPost).not.toHaveBeenCalled();
  });

  it("saves edited media before rescheduling a scheduled post", async () => {
    freezeClock();
    const user = userEvent.setup();
    vi.mocked(updateProjectSocialPost).mockResolvedValue({
      ok: true,
      value: { ...SCHEDULED_POST, media: [IMAGE_REF], revision: 3 },
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    await openRowMenu(user, "post-scheduled");
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    );
    await user.click(screen.getByRole("button", { name: "pick launch.png" }));
    await pickInAnHour(user, dialog);
    await user.click(
      within(dialog).getByRole("button", { name: /^Reschedule/ }),
    );

    await waitFor(() => {
      expect(updateProjectSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: "post-scheduled",
          revision: 2,
          media: [expect.objectContaining({ pathname: IMAGE_REF.pathname })],
        }),
      );
    });
    await waitFor(() => {
      expect(scheduleProjectSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: "post-scheduled",
          revision: 3,
        }),
      );
    });
  });

  it("refuses to attach the same Drive file twice", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    );
    await user.click(screen.getByRole("button", { name: "pick launch.png" }));
    await user.click(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    );
    await user.click(screen.getByRole("button", { name: "pick launch.png" }));

    expect(toastErrorMock).toHaveBeenCalledWith(
      "That file is already attached.",
    );
    expect(
      within(dialog).getByTestId("social-post-media").querySelectorAll("img"),
    ).toHaveLength(1);
  });

  it("cancels a scheduled post only after confirmation", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    await openRowMenu(user, "post-scheduled");
    await user.click(screen.getByRole("menuitem", { name: "Cancel post" }));
    expect(cancelProjectSocialPost).not.toHaveBeenCalled();

    const alert = screen.getByRole("alertdialog");
    await user.click(
      within(alert).getByRole("button", { name: "Cancel post" }),
    );

    await waitFor(() => {
      expect(cancelProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-scheduled",
        revision: 2,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post canceled.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("social-posts-selected"),
    ).not.toBeInTheDocument();
  });

  it("toasts and refreshes on a revision conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(cancelProjectSocialPost).mockResolvedValue({
      ok: false,
      error: {
        code: "BAD_INPUT",
        kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
        message: "Conflict copy can change freely",
      },
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    await openRowMenu(user, "post-scheduled");
    await user.click(screen.getByRole("menuitem", { name: "Cancel post" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel post",
      }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "This post was changed elsewhere. Reloading the latest version.",
      );
    });
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("warns when the linked account needs reconnecting and links to the accounts section", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          {
            ...SCHEDULED_POST,
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: null,
              avatarUrl: null,
              status: "reauthorization_required",
            },
            connectionNeedsReconnect: true,
          },
        ]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    const warning = within(screen.getByRole("dialog")).getByTestId(
      "social-post-needs-reconnect",
    );
    expect(warning).toHaveTextContent("Account needs reconnecting");
  });

  it("does not warn about reconnecting when the connection is active", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    expect(
      screen.queryByTestId("social-post-needs-reconnect"),
    ).not.toBeInTheDocument();
  });

  it("shows the failure reason, time, and attempt count on a FAILED row with Retry and Reschedule", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[FAILED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Needs attention")).toHaveTextContent("Needs attention 1");
    await openTab(user, "Needs attention");
    const attention = screen.getByTestId("social-posts-section-attention");
    const row = within(attention).getByTestId("social-post-post-failed");
    expect(
      within(row).getByText("X rejected the post (403 forbidden)"),
    ).toBeVisible();
    expect(within(row).getByText("Failed Sep 10, 10:05 AM")).toBeVisible();
    expect(within(row).getByText("3 attempts")).toBeVisible();
    expect(within(row).getByText("Failed")).toBeVisible();
    // Retry is the one thing left to do, so it sits on the row.
    expect(within(row).getByRole("button", { name: "Retry" })).toBeVisible();

    await openRowMenu(user, "post-failed");
    expect(screen.getByRole("menuitem", { name: "Reschedule" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Publish now" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("shows the missed reason on a MISSED row", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          {
            ...FAILED_POST,
            id: "post-missed",
            status: "MISSED",
            lastError: "Scheduled time passed more than an hour ago",
          },
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const row = screen.getByTestId("social-post-post-missed");
    expect(
      within(row).getByText("Scheduled time passed more than an hour ago"),
    ).toBeVisible();
    expect(within(row).getByText("Missed")).toBeVisible();
  });

  it("retries a FAILED post after confirmation and toasts when it is published", async () => {
    const user = userEvent.setup();
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: {
        ...FAILED_POST,
        status: "PUBLISHED",
        publishedAt: new Date("2026-09-15T12:00:00.000Z"),
        publishedUrl: "https://x.com/sokosumi/status/42",
        lastError: null,
        attemptCount: 4,
        revision: 6,
        canSchedule: false,
        canPublishNow: false,
      },
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[FAILED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    await user.click(
      within(screen.getByTestId("social-post-post-failed")).getByRole(
        "button",
        { name: "Retry" },
      ),
    );
    expect(publishProjectSocialPost).not.toHaveBeenCalled();

    const alert = screen.getByRole("alertdialog");
    expect(
      within(alert).getByRole("heading", { name: "Publish this post now?" }),
    ).toBeVisible();
    await user.click(
      within(alert).getByRole("button", { name: "Publish now" }),
    );

    await waitFor(() => {
      expect(publishProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-failed",
        revision: 5,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post published.");
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    // Nothing needs attention any more, so the tab goes and the page falls
    // back to its first tab; the published post lives on the calendar.
    expect(
      screen.queryByRole("tab", { name: /^Needs attention/ }),
    ).not.toBeInTheDocument();
    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");
    expect(
      screen.queryByTestId("social-post-post-failed"),
    ).not.toBeInTheDocument();
  });

  it("publishes a draft now and toasts the failure reason when Core reports FAILED", async () => {
    const user = userEvent.setup();
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: {
        ...buildPost(),
        status: "FAILED",
        lastError: "X is unavailable",
        attemptCount: 1,
        revision: 1,
        canEdit: false,
        canCancel: false,
      },
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Drafts");
    await openRowMenu(user, "post-draft");
    await user.click(screen.getByRole("menuitem", { name: "Publish now" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Publish now",
      }),
    );

    await waitFor(() => {
      expect(publishProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-draft",
        revision: 0,
      });
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      "Publishing failed: X is unavailable",
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    // The failed post takes the list with it to Needs attention.
    expect(getTab("Needs attention")).toHaveAttribute("aria-selected", "true");
    const attention = screen.getByTestId("social-posts-section-attention");
    const row = within(attention).getByTestId("social-post-post-draft");
    expect(within(row).getByText("X is unavailable")).toBeVisible();

    await openTab(user, "Drafts");
    expect(screen.getByText("No drafts yet.")).toBeVisible();
  });

  it("toasts and refreshes when publishing hits a revision conflict", async () => {
    const user = userEvent.setup();
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: false,
      error: {
        code: "BAD_INPUT",
        kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
        message: "Conflict copy can change freely",
      },
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Drafts");
    await openRowMenu(user, "post-draft");
    await user.click(screen.getByRole("menuitem", { name: "Publish now" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Publish now",
      }),
    );

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "This post was changed elsewhere. Reloading the latest version.",
      );
    });
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("refreshes a managed published post from its preview and keeps metrics on failure", async () => {
    const next = {
      ...PUBLISHED_POST,
      statistics: {
        metrics: {
          views: 7,
          impressions: null,
          likes: 0,
          comments: null,
          shares: null,
          saves: null,
        },
        fetchedAt: new Date("2026-10-08T08:00:00Z"),
        refreshAttemptedAt: new Date("2026-10-08T08:00:00Z"),
        error: null,
      },
    };
    vi.mocked(refreshProjectSocialPostStatistics)
      .mockResolvedValueOnce({ ok: true, value: next })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "BAD_INPUT", message: "Denied" },
      });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHED_POST]}
        projectId={PROJECT_ID}
        selectedPostId={PUBLISHED_POST.id}
      />,
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Refresh statistics" }),
    );
    expect(await within(dialog).findByText("7")).toBeVisible();
    expect(refreshProjectSocialPostStatistics).toHaveBeenCalledWith({
      projectId: PUBLISHED_POST.projectId,
      postId: PUBLISHED_POST.id,
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Refresh statistics" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Previous results are retained",
    );
    expect(within(dialog).getByText("7")).toBeVisible();
  });

  it("opens a linked published post in the preview with its external link", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-published"
      />,
    );
    const dialog = screen.getByRole("dialog");
    expect(screen.queryByText("Selected post")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: "View post" }),
    ).toHaveAttribute("href", "https://x.com/sokosumi/status/1234567890");
    expect(
      within(dialog).queryByRole("button", { name: "Post actions" }),
    ).not.toBeInTheDocument();
  });

  it("shows a PUBLISHING post a link names without actions", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHING_POST]}
        projectId={PROJECT_ID}
        selectedPostId={PUBLISHING_POST.id}
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).queryByRole("button", { name: "Post actions" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("social-posts-selected"),
    ).not.toBeInTheDocument();
  });

  it("orders Needs attention by latest change and leaves canceled posts out", async () => {
    const user = userEvent.setup();
    const canceled = buildPost({
      id: "post-canceled",
      status: "CANCELED",
      canceledAt: new Date("2026-09-05T10:00:00.000Z"),
      updatedAt: new Date("2026-09-05T10:00:00.000Z"),
      canEdit: false,
      canSchedule: false,
      canPublishNow: false,
    });
    const failed = {
      ...FAILED_POST,
      updatedAt: new Date("2026-09-10T10:05:00.000Z"),
    };
    const missed = {
      ...FAILED_POST,
      id: "post-missed",
      status: "MISSED" as const,
      updatedAt: new Date("2026-09-12T10:00:00.000Z"),
    };
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHED_POST, canceled, failed, missed]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const attention = screen.getByTestId("social-posts-section-attention");
    const rows = within(attention).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "social-post-post-missed",
      "social-post-post-failed",
    ]);
    expect(
      screen.queryByTestId("social-post-post-canceled"),
    ).not.toBeInTheDocument();
  });

  it("opens the linked draft in a preview", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost(), SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-draft"
      />,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.queryByTestId("social-posts-selected"),
    ).not.toBeInTheDocument();
  });

  it("loads more drafts without replacing the listed ones", async () => {
    const user = userEvent.setup();
    vi.mocked(loadMoreSocialPosts).mockResolvedValue({
      posts: [buildPost({ id: "older", text: "Older draft" })],
      nextCursor: null,
    });
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
        posts={[buildPost(), SCHEDULED_POST]}
        nextCursors={{ drafts: "drafts-cursor" }}
      />,
    );
    // More drafts wait on the server, so the count says so.
    expect(getTab("Drafts")).toHaveTextContent("Drafts 1+");

    await openTab(user, "Drafts");
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Older draft")).toBeVisible());
    expect(loadMoreSocialPosts).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      section: "drafts",
      cursor: "drafts-cursor",
    });
    expect(screen.getByTestId("social-post-post-draft")).toBeVisible();
    expect(getTab("Drafts")).toHaveTextContent("Drafts 2");
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });

  it("closes a conflicted editor and uses the refreshed revision when reopened", async () => {
    const user = userEvent.setup();
    const original = buildPost({ revision: 4 });
    vi.mocked(updateProjectSocialPost).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "BAD_INPUT",
        kind: CORE_API_ERROR_KINDS.SOCIAL_POST_REVISION_CONFLICT,
        message: "Conflict copy can change freely",
      },
    });
    const { rerender } = render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
        posts={[original]}
      />,
    );
    await openTab(user, "Drafts");
    await openRowMenu(user, original.id);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    const refreshed = { ...original, revision: 5 };
    rerender(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
        posts={[refreshed]}
      />,
    );
    vi.mocked(updateProjectSocialPost).mockResolvedValueOnce({
      ok: true,
      value: { ...refreshed, revision: 6 },
    });
    await openRowMenu(user, original.id);
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(updateProjectSocialPost).toHaveBeenLastCalledWith(
        expect.objectContaining({ revision: 5 }),
      ),
    );
  });

  it("renders the complete post text without a line clamp", () => {
    render(
      <ProjectSocialPosts
        connections={[]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    expect(screen.getByText("Scheduled text")).not.toHaveClass("line-clamp-2");
  });

  it("offers only times after the shared schedule lead time", async () => {
    freezeClock(new Date(2026, 8, 24, 10, 0, 15));
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Pick a time" }),
    );

    const times = screen.getByRole("listbox", { name: "Times" });
    const option = (hour: number, minute: number) =>
      within(times)
        .getAllByRole("option")
        .find(
          (candidate) =>
            candidate.textContent ===
            createTestFormatter().dateTime(
              new Date(2026, 8, 24, hour, minute),
              "time",
            ),
        );
    expect(option(10, 0)).toBeDisabled();
    expect(option(10, 15)).toBeEnabled();
  });

  it("names the viewer's time zone and the time a post goes out", async () => {
    freezeClock();
    const user = userEvent.setup();
    const zone = Intl.DateTimeFormat()
      .resolvedOptions()
      .timeZone.replaceAll("_", " ");
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const line = within(dialog).getByTestId("social-post-timezone");
    expect(line).toHaveTextContent(`Times are in your time zone, ${zone}.`);

    await pickInAnHour(user, dialog);
    expect(line).toHaveTextContent(
      `Goes out ${createTestFormatter().dateTime(IN_AN_HOUR, "dateTimeWithYear")}, your time (${zone}).`,
    );
  });

  it("shows a post's own time zone when it differs from the viewer's", async () => {
    const user = userEvent.setup();
    const otherZone =
      Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Tokyo"
        ? "Europe/Berlin"
        : "Asia/Tokyo";
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[{ ...SCHEDULED_POST, timezone: otherZone }]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    await openRowMenu(user, "post-scheduled");
    await user.click(screen.getByRole("menuitem", { name: "Reschedule" }));
    expect(
      within(screen.getByRole("dialog")).getByTestId("social-post-timezone"),
    ).toHaveTextContent(`in ${otherZone.replaceAll("_", " ")}.`);
  });

  it("schedules from the date and time pickers", async () => {
    freezeClock();
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Picked");
    await user.click(within(dialog).getByRole("button", { name: /^Tomorrow/ }));
    await user.click(within(dialog).getByRole("button", { name: /^Time:/ }));
    const times = screen.getByRole("listbox", { name: "Times" });
    const twoThirty = createTestFormatter().dateTime(
      new Date(2026, 8, 21, 14, 30),
      "time",
    );
    await user.click(within(times).getByRole("option", { name: twoThirty }));
    await user.click(within(dialog).getByRole("button", { name: /^Schedule/ }));

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledAt: new Date(2026, 8, 21, 14, 30).toISOString(),
        }),
      );
    });
  });

  it("routes rejected authentication through the sign-in toast", async () => {
    const user = userEvent.setup();
    const authError = new Error("User is not authenticated") as Error & {
      digest: string;
    };
    authError.name = "UnAuthenticatedError";
    authError.digest = "UNAUTHENTICATED";
    vi.mocked(createProjectSocialPost).mockRejectedValue(authError);
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Fresh");
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Please log in to continue.",
        expect.objectContaining({ action: expect.any(Object) }),
      ),
    );
    const toastOptions = toastErrorMock.mock.calls.at(-1)?.[1] as {
      action: { onClick: () => void };
    };
    toastOptions.action.onClick();
    expect(pushMock).toHaveBeenCalledWith("/signin");
  });

  it("shows the fallback error when canceling rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(cancelProjectSocialPost).mockRejectedValue(
      new Error("network down"),
    );
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    await openRowMenu(user, "post-scheduled");
    await user.click(screen.getByRole("menuitem", { name: "Cancel post" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Cancel post",
      }),
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Something went wrong. Try again.",
      ),
    );
  });

  it("shows the fallback error when saving a draft rejects", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost).mockRejectedValue(
      new Error("network down"),
    );
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Fresh");
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Something went wrong. Try again.",
      ),
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("shows the fallback error when scheduling rejects", async () => {
    freezeClock();
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost).mockRejectedValue(
      new Error("network down"),
    );
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Scheduled text");
    await pickInAnHour(user, dialog);
    await user.click(within(dialog).getByRole("button", { name: /^Schedule/ }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Something went wrong. Try again.",
      ),
    );
  });

  it("localizes a revoked scheduling authorization failure", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({
            ...FAILED_POST,
            lastError: "Internal authorization failure text",
            lastAttempt: {
              ...FAILED_POST.lastAttempt!,
              outcome: "authorization_revoked",
            },
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const row = screen.getByTestId("social-post-post-failed");
    expect(
      within(row).getByText(
        "Coworker scheduling access was revoked. Reschedule this post to publish it.",
      ),
    ).toBeVisible();
    expect(
      within(row).queryByText("Internal authorization failure text"),
    ).not.toBeInTheDocument();
  });
});
