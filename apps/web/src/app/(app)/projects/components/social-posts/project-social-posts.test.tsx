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
import { useQueryState } from "nuqs";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import {
  SocialComposeProvider,
  useSocialCompose,
} from "@/app/social/components/social-compose-context";
import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import {
  cancelProjectSocialPost,
  createProjectSocialPost,
  duplicateProjectSocialPost,
  finalizeProjectSocialConnection,
  initiateProjectSocialConnection,
  publishProjectSocialPost,
  refreshProjectSocialPostStatistics,
  scheduleProjectSocialPost,
  updateProjectSocialPost,
} from "@/lib/actions/project/action";
import { formatTimezoneLabel } from "@/lib/schedules/timezones";
import { writeSocialComposePrefill } from "@/lib/social-compose-prefill";
import { createTestFormatter } from "@/test/intl-formatter";
import { TestQueryProvider } from "@/test/query-provider";
import { stubLoadedImage } from "@/test/stub-pending-image-load";

import { loadMoreSocialPosts } from "./actions";
import { writeRememberedComposerAccounts } from "./social-post-composer-accounts";

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdSocialConnections: (...args: unknown[]) =>
      getSocialConnectionsMock(...args),
    getProjectsByIdSocialConnectionsByConnectionIdSuggestedTimes: (
      ...args: unknown[]
    ) => getSuggestedTimesMock(...args),
    getProjectsByIdSocialConnectionsByConnectionIdSubscription: (
      ...args: unknown[]
    ) => getSubscriptionMock(...args),
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
  getSuggestedTimesMock,
  getSubscriptionMock,
} = vi.hoisted(() => ({
  pushMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  uploadDriveFileMock: vi.fn(),
  getSocialConnectionsMock: vi.fn(),
  getSuggestedTimesMock: vi.fn(),
  getSubscriptionMock: vi.fn(),
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
  tryAgain: "Try again",
  help: "Everything else still works. Check your connection and try again.",
  "title.drafts": "Couldn't load drafts",
  "title.attention": "Couldn't load posts that need attention",
  "title.accounts": "Couldn't load accounts",
  "title.calendar": "Couldn't load the calendar",
  "title.post": "Couldn't open that post",
  loadMore: "Load more",
  loadMoreError: "Couldn't load more.",
  loadMoreOffline: "You're offline.",
  loadMoreTimeout: "Timed out.",
  loading: "Loading…",
  description: "Draft text posts for X and schedule them from this Project.",
  newPost: "New post",
  moreActions: "Post actions",
  moreActionsNamed: "Post actions for {handle}",
  thisDraft: "this draft",
  noAccount: "No account",
  needsReconnect: "Account needs reconnecting",
  needsReconnectLink: "Reconnect the account",
  reconnect: "Reconnect",
  "reconnection.accounts": "Accounts needing attention",
  "reconnection.title": "{account} needs reconnecting",
  "reconnection.affected": "{count} posts affected",
  "reconnection.retryTitle": "Retry failed posts?",
  "reconnection.retryDescription": "Retry {count} failed posts?",
  "reconnection.later": "Later",
  viewPost: "View post",
  publishedAt: "Published {date}",
  failedAt: "Failed {date}",
  attempts: "{count} attempts",
  "actions.publishNow": "Post now",
  "actions.retry": "Retry",
  "actions.duplicate": "Duplicate as draft",
  "actions.dismiss": "Dismiss",
  "filters.platform": "Platform",
  "sections.calendar": "Calendar",
  "sections.drafts": "Drafts",
  "sections.attention": "Needs attention",
  "sections.accounts": "Accounts",
  "sections.statistics": "Performance",
  "statistics.refresh": "Refresh statistics",
  "statistics.refreshFailed":
    "Failed to refresh statistics. Previous results are retained.",
  "connectPrompt.title": "Connect an account to start posting",
  "connectPrompt.body": "Posts go out from this project's accounts.",
  "connectPrompt.action": "Connect account",
  "reconnectPrompt.title": "Reconnect to post",
  "reconnectPrompt.body": "Sign in again on a connected account.",
  "reconnectPrompt.action": "Reconnect",
  selectedPost: "Selected post",
  "empty.drafts": "No drafts yet.",
  "empty.more": "More posts are available.",
  "emptyHint.drafts": "Save a draft to finish later.",
  "status.DRAFT": "Draft",
  "status.NEEDS_APPROVAL": "Needs approval",
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
  "composer.firstComment": "First comment",
  "composer.firstCommentPlaceholder": "Hashtags or a call to action",
  "composer.firstCommentTooLong": "First comment is too long.",
  "composer.textForAccount": "Text for this account",
  "composer.characters": "{count} / {limit}",
  "composer.media.addFromDrive": "Add from Drive",
  "composer.media.drop": "Drop files to attach",
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
  "composer.pickAccount": "Pick an account to post to.",
  "composer.tooLong": "Text length is over the limit.",
  "composer.requirements.text_or_media_required": "Add text or media.",
  "composer.requirements.text_required": "{provider} requires text.",
  "composer.requirements.media_required":
    "{provider} requires at least one image or video.",
  "composer.requirements.video_required": "{provider} requires a video.",
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
  "composer.discardTitle": "Discard changes?",
  "composer.discardDescription": "Your changes will be lost.",
  "composer.discard": "Discard",
  "composer.keepEditing": "Keep editing",
  "composer.when": "When",
  "composer.scheduleFor": "Schedule for {date}",
  "composer.rescheduleFor": "Reschedule for {date}",
  "composer.connectAccount": "Connect account",
  "composer.previewEmpty": "Your post shows here as you write.",
  now: "Now",
  accountFallback: "Your account",
  label: "{provider} preview",
  "cancelDialog.title": "Cancel this post?",
  "cancelDialog.description":
    "The post will not be published. This cannot be undone.",
  "cancelDialog.confirm": "Cancel post",
  "dismissDialog.title": "Dismiss this post?",
  "dismissDialog.description": "It leaves Needs attention.",
  "dismissDialog.confirm": "Dismiss",
  "publishDialog.title": "Post this now?",
  "publishDialog.description":
    "The post goes out to X right away instead of waiting for its scheduled time.",
  "publishDialog.confirm": "Post now",
  "retryDialog.title": "Retry this post?",
  "retryDialog.description": "The post goes out now.",
  "retryDialog.confirm": "Retry",
  "bulkRetry.selectPost": "Select this post",
  "bulkRetry.selectAll": "Select all posts that can be retried",
  "bulkRetry.selected": "{count} selected",
  "bulkRetry.retrySelected": "Retry selected",
  "bulkRetry.title": "Retry these posts now?",
  "bulkRetry.description":
    "Each selected post goes out right away. You will see which ones published and which still need attention.",
  "bulkRetry.confirm": "Retry selected",
  "bulkRetry.resultsTitle": "Retry results",
  "bulkRetry.published": "Published",
  "toasts.published": "Post published.",
  "toasts.publishFailed": "Publishing failed: {error}",
  "toasts.publishFailedItem": "{account} — {error}",
  "toasts.created": "Draft saved.",
  "toasts.scheduled": "Post scheduled.",
  "toasts.updated": "Post updated.",
  "toasts.canceled": "Post canceled.",
  "toasts.duplicated": "Draft created.",
  "toasts.dismissed": "Post dismissed.",
  "toasts.conflict":
    "This post was changed elsewhere. Reloading the latest version.",
  "toasts.failed": "Something went wrong. Try again.",
  "toasts.offline": "You're offline. Try again.",
  "toasts.timeout": "Timed out. Try again.",
  "toasts.missingPost": "Couldn't open this post.",
  "composer.scheduledAtTooSoon": "Choose a time at least one minute from now.",
  "composer.timezone.yours": "Times are in your time zone, {zone}.",
  "composer.timezone.goesOut": "Goes out {date} · {zone}",
  "composer.timezone.postZone": "Scheduled as {date} · {zone}",
  quickPicks: "Quick picks",
  "quick.inAnHour": "In an hour ({time})",
  "quick.tomorrowMorning": "Tomorrow {time}",
  "quick.nextMonday": "Monday {time}",
  pickDate: "Pick a date",
  pickTime: "Pick a time",
  dateSelected: "Date: {date}",
  timeSelected: "Time: {time}",
  times: "Times",
  suggestedTimes: "Suggested times",
  suggested: "Best {time}",
  "toasts.unauthenticated": "Please log in to continue.",
  "toasts.unauthenticatedAction": "Log in",
  "preview.open": "Preview",
  "preview.openNamed": "Preview {handle}",
  "preview.accounts": "Preview account",
  "preview.as": "Preview as {provider} {handle}",
  "preview.dialogTitle": "Post preview",
  "outcomes.authorizationRevoked":
    "Coworker scheduling access was revoked. Reschedule this post to publish it.",
  "outcomes.connectionInactive": "Account disconnected. Reconnect to retry.",
  "outcomes.missed": "Missed the scheduled time.",
  "failures.generic": "Couldn't publish. Open the post for details.",
  "failures.rateLimited": "Rate limited. Try again later.",
  "failures.timeout": "Timed out. Try again.",
  "failures.unauthorized": "Reconnect the account.",
  "failures.unavailable": "The platform is down. Try again later.",
  "failures.rejected": "The platform rejected this post.",
  "failures.mediaMissing": "A file is missing.",
  "failures.mediaType": "That file type is not allowed.",
};

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    useFormatter: () => createTestFormatter(),
    useLocale: () => "en",
    useTimeZone: () => "UTC",
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
  finalizeProjectSocialConnection: vi.fn(),
  initiateProjectSocialConnection: vi.fn(),
  cancelProjectSocialPost: vi.fn(),
  createProjectSocialPost: vi.fn(),
  duplicateProjectSocialPost: vi.fn(),
  publishProjectSocialPost: vi.fn(),
  refreshProjectSocialPostStatistics: vi.fn(),
  scheduleProjectSocialPost: vi.fn(),
  updateProjectSocialPost: vi.fn(),
}));

vi.mock("@/lib/actions/composio/action", () => ({
  completeComposioAuthCallbackAction: vi.fn(),
}));
vi.mock("@/lib/composio/use-composio-oauth-popup", () => ({
  useComposioOAuthPopup: () => ({
    runPopupOAuth: async (
      run: (flow: {
        navigate: (url: string) => void;
        waitForCallback: () => Promise<unknown>;
      }) => Promise<void>,
    ) => {
      const value = await run({
        navigate: vi.fn(),
        waitForCallback: async () => ({
          kind: "callback",
          payload: {
            status: "success",
            connectionId: "ca-1",
            sessionUri: "https://backend.composio.dev/session/reconnect",
          },
        }),
      });
      return { kind: "completed", value };
    },
  }),
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
    subscriptionType: null,
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
    firstComment: null,
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
    canApprove: false,
    canReject: false,
    canDuplicate: false,
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
    subscriptionType: null,
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
  canDuplicate: true,
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
    subscriptionType: null,
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
  canCancel: true,
  canPublishNow: true,
  canDuplicate: true,
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
    subscriptionType: null,
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

const GIF_REF: SocialPostMediaRef = {
  pathname: "drive/users/user_1/loop.gif",
  fileUrl:
    "https://store.public.blob.vercel-storage.com/drive/users/user_1/loop.gif",
  name: "loop.gif",
  size: 4096,
  mimeType: "image/gif",
  kind: "gif",
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
  await user.click(within(row).getByRole("button", { name: /^Post actions/ }));
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

function ComposeHarness({
  children,
  searchParams,
}: {
  children: React.ReactNode;
  searchParams?: string;
}) {
  return (
    <TestQueryProvider>
      <NuqsTestingAdapter searchParams={searchParams}>
        <SocialComposeProvider>
          <NewPostButton />
          {children}
        </SocialComposeProvider>
      </NuqsTestingAdapter>
    </TestQueryProvider>
  );
}

function render(ui: React.ReactElement, searchParams?: string) {
  return renderUi(ui, {
    wrapper: ({ children }) => (
      <ComposeHarness searchParams={searchParams}>{children}</ComposeHarness>
    ),
  });
}

describe("ProjectSocialPosts", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    sessionStorage.clear();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    getSocialConnectionsMock.mockRejectedValue(
      new Error("photo lookup unavailable"),
    );
    getSuggestedTimesMock.mockResolvedValue({ data: { hours: [] } });
    getSubscriptionMock
      .mockReset()
      .mockRejectedValue(new Error("subscription lookup unavailable"));
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
    vi.mocked(publishProjectSocialPost).mockReset();
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: { ...PUBLISHED_POST, id: "post-draft", text: "Draft text" },
    });
  });

  it("keeps attention ordered by failure time after edits and loading another page", async () => {
    const user = userEvent.setup();
    const recent = { ...FAILED_POST, id: "recent" };
    const edited = {
      ...FAILED_POST,
      id: "edited",
      lastAttemptAt: new Date("2026-09-08T10:00:00.000Z"),
      updatedAt: new Date("2026-09-12T10:00:00.000Z"),
    };
    vi.mocked(loadMoreSocialPosts).mockResolvedValue({
      posts: [
        {
          ...FAILED_POST,
          id: "middle",
          lastAttemptAt: new Date("2026-09-09T10:00:00.000Z"),
          updatedAt: new Date("2026-09-13T10:00:00.000Z"),
        },
      ],
      nextCursor: null,
    });
    renderUi(
      <TestQueryProvider>
        <NuqsTestingAdapter searchParams="?tab=attention">
          <ProjectSocialPosts
            connections={[buildConnection()]}
            nextCursors={{ attention: "next-page" }}
            posts={[recent, edited]}
            projectId={PROJECT_ID}
          />
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );
    const rows = () =>
      within(screen.getByTestId("social-posts-section-attention"))
        .getAllByRole("listitem")
        .map((row) => row.id);
    expect(rows()).toEqual(["social-post-recent", "social-post-edited"]);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(rows()).toEqual([
        "social-post-recent",
        "social-post-middle",
        "social-post-edited",
      ]),
    );
  });

  it("shows a broken account without failed posts in Needs attention", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[]}
        managedConnections={[
          buildConnection({ status: "reauthorization_required" }),
        ]}
        affectedPosts={[SCHEDULED_POST]}
        posts={[]}
      />,
    );
    expect(getTab("Needs attention")).toHaveTextContent("Needs attention 1");
    await openTab(user, "Needs attention");
    const row = screen.getByTestId("social-reconnect-connection-1");
    expect(within(row).getByText("@sokosumi needs reconnecting")).toBeVisible();
    expect(within(row).getByText("1 posts affected")).toBeVisible();
  });

  it("hides the generic banner only while per-account reconnect items render", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[]}
        managedConnections={[
          buildConnection({ status: "reauthorization_required" }),
        ]}
        accountCount={1}
        accounts={<p>Accounts panel</p>}
        calendar={<p>Calendar panel</p>}
        posts={[]}
      />,
    );
    expect(screen.getByTestId("social-reconnect-prompt")).toBeVisible();
    await openTab(user, "Needs attention");
    expect(screen.getByTestId("social-reconnect-connection-1")).toBeVisible();
    expect(
      screen.queryByTestId("social-reconnect-prompt"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/posts affected/)).not.toBeInTheDocument();
    await openTab(user, "Calendar");
    expect(screen.getByTestId("social-reconnect-prompt")).toBeVisible();
  });

  it("offers retry only after successful reconnect and reuses the publish action", async () => {
    const user = userEvent.setup();
    const failed = {
      ...FAILED_POST,
      connectionNeedsReconnect: true,
      lastError: "Social connection needs reconnecting",
    };
    vi.mocked(initiateProjectSocialConnection).mockResolvedValue({
      ok: true,
      value: {
        connectionId: "ca-1",
        redirectUrl: "https://connect.composio.dev/reconnect",
      },
    });
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.mocked(finalizeProjectSocialConnection).mockResolvedValue({
      ok: true,
      value: buildConnection({ connectedAt: new Date("2026-10-14") }),
    });
    vi.mocked(publishProjectSocialPost).mockResolvedValue({
      ok: true,
      value: { ...PUBLISHED_POST, id: failed.id },
    });
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[]}
        managedConnections={[
          buildConnection({ status: "reauthorization_required" }),
        ]}
        affectedPosts={[
          failed,
          SCHEDULED_POST,
          {
            ...FAILED_POST,
            id: "bad-media",
            lastError: "upload X image failed (400)",
            connectionNeedsReconnect: true,
          },
        ]}
        posts={[failed]}
      />,
    );
    await openTab(user, "Needs attention");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    const row = screen.getByTestId("social-reconnect-connection-1");
    expect(within(row).getByText("2 posts affected")).toBeVisible();
    await user.click(within(row).getByRole("button", { name: "Reconnect" }));
    expect(initiateProjectSocialConnection).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      action: "reconnect",
      socialConnectionId: "connection-1",
    });
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Retry 1 failed posts?")).toBeVisible();
    expect(publishProjectSocialPost).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(publishProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: failed.id,
        revision: failed.revision,
      }),
    );
    expect(publishProjectSocialPost).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("social-reconnect-connection-1"),
    ).not.toBeInTheDocument();
  });

  it("does not offer retry when reconnect fails", async () => {
    const user = userEvent.setup();
    vi.mocked(initiateProjectSocialConnection).mockResolvedValue({
      ok: true,
      value: {
        connectionId: "ca-1",
        redirectUrl: "https://connect.composio.dev/reconnect",
      },
    });
    vi.mocked(completeComposioAuthCallbackAction).mockResolvedValue({
      ok: true,
      value: undefined,
    });
    vi.mocked(finalizeProjectSocialConnection).mockResolvedValue({
      ok: false,
      error: {
        code: CommonErrorCode.INTERNAL_SERVER_ERROR,
        message: "Reconnect failed",
      },
    });
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[]}
        managedConnections={[
          buildConnection({ status: "reauthorization_required" }),
        ]}
        posts={[FAILED_POST]}
      />,
    );
    await openTab(user, "Needs attention");
    await user.click(
      within(screen.getByTestId("social-reconnect-connection-1")).getByRole(
        "button",
        { name: "Reconnect" },
      ),
    );
    await waitFor(() =>
      expect(finalizeProjectSocialConnection).toHaveBeenCalled(),
    );
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("social-reconnect-connection-1"),
    ).toBeInTheDocument();
    expect(publishProjectSocialPost).not.toHaveBeenCalled();
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
      "Performance ",
    ]);
    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");

    const drafts = screen.getByTestId("social-posts-section-drafts");
    const draftRow = within(drafts).getByTestId("social-post-post-draft");
    expect(within(draftRow).getByTestId("social-post-preview")).toBeVisible();
    expect(within(draftRow).getByText("Draft text")).toBeVisible();
    expect(
      within(draftRow).getByRole("button", { name: "Preview this draft" }),
    ).toBeVisible();
    expect(
      within(draftRow).getByRole("button", {
        name: "Post actions for this draft",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("social-posts-drafts-grid")).toHaveClass(
      "items-stretch",
      "sm:grid-cols-2",
      "xl:grid-cols-3",
    );
    expect(
      within(draftRow).getByRole("button", { name: "Preview this draft" }),
    ).toHaveClass("size-11", "md:size-10");
    expect(
      within(draftRow).getByRole("button", {
        name: "Post actions for this draft",
      }),
    ).toHaveClass("size-11", "md:size-10");
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

  it("narrows Needs attention by platform", () => {
    renderUi(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          FAILED_POST,
          buildPost({
            ...FAILED_POST,
            id: "post-failed-li",
            provider: "linkedin",
            text: "LinkedIn failed",
          }),
        ]}
        projectId={PROJECT_ID}
      />,
      {
        wrapper: ({ children }) => (
          <TestQueryProvider>
            <NuqsTestingAdapter searchParams="?tab=attention&provider=linkedin">
              <SocialComposeProvider>{children}</SocialComposeProvider>
            </NuqsTestingAdapter>
          </TestQueryProvider>
        ),
      },
    );

    const attention = screen.getByTestId("social-posts-section-attention");
    expect(within(attention).getByText("LinkedIn failed")).toBeVisible();
    expect(
      within(attention).queryByText("Failed text"),
    ).not.toBeInTheDocument();
    expect(getTab("Needs attention")).toHaveTextContent("Needs attention 2");
    expect(screen.getByTestId("social-posts-platform-filter")).toBeVisible();
  });

  it("narrows reconnect rows and attention posts by the same platform", () => {
    render(
      <ProjectSocialPosts
        connections={[]}
        managedConnections={[
          buildConnection({ status: "reauthorization_required" }),
          buildConnection({
            id: "connection-li",
            provider: "linkedin",
            status: "reauthorization_required",
          }),
        ]}
        posts={[
          FAILED_POST,
          buildPost({
            ...FAILED_POST,
            id: "post-failed-li",
            provider: "linkedin",
            text: "LinkedIn failed",
          }),
        ]}
        projectId={PROJECT_ID}
      />,
      "?tab=attention&provider=linkedin",
    );

    const attention = screen.getByTestId("social-posts-section-attention");
    expect(
      within(attention).getByTestId("social-reconnect-connection-li"),
    ).toBeVisible();
    expect(
      within(attention).queryByTestId("social-reconnect-connection-1"),
    ).not.toBeInTheDocument();
    expect(within(attention).getByText("LinkedIn failed")).toBeVisible();
    expect(
      within(attention).queryByText("Failed text"),
    ).not.toBeInTheDocument();
    expect(getTab("Needs attention")).toHaveTextContent("Needs attention 4");
  });

  it.each([false, true])(
    "retries only the visible platform after a filter change: %s",
    async (changeFilterAfterSelection) => {
      const user = userEvent.setup();
      const linkedInFailed = buildPost({
        ...FAILED_POST,
        id: "post-failed-li",
        provider: "linkedin",
        text: "LinkedIn failed",
        revision: 7,
      });
      vi.mocked(publishProjectSocialPost).mockResolvedValue({
        ok: true,
        value: {
          ...linkedInFailed,
          status: "PUBLISHED",
          revision: 8,
          canPublishNow: false,
        },
      });

      function FilterToLinkedIn() {
        const [, setProvider] = useQueryState("provider");
        return (
          <button type="button" onClick={() => void setProvider("linkedin")}>
            Filter to LinkedIn
          </button>
        );
      }

      render(
        <>
          <FilterToLinkedIn />
          <ProjectSocialPosts
            connections={[buildConnection()]}
            posts={[FAILED_POST, linkedInFailed]}
            projectId={PROJECT_ID}
          />
        </>,
        changeFilterAfterSelection
          ? "?tab=attention"
          : "?tab=attention&provider=linkedin",
      );

      if (changeFilterAfterSelection) {
        await user.click(screen.getByTestId("social-post-select-post-failed"));
        expect(screen.getByText("1 selected")).toBeVisible();
        await user.click(
          screen.getByRole("button", { name: "Filter to LinkedIn" }),
        );
        await waitFor(() => {
          expect(screen.getByText("0 selected")).toBeVisible();
        });
        expect(
          screen.getByRole("button", { name: "Retry selected" }),
        ).toBeDisabled();
      }

      const attention = screen.getByTestId("social-posts-section-attention");
      expect(within(attention).getByText("LinkedIn failed")).toBeVisible();
      expect(
        within(attention).queryByTestId("social-post-post-failed"),
      ).not.toBeInTheDocument();
      await user.click(screen.getByTestId("social-bulk-retry-select-all"));
      expect(screen.getByText("1 selected")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Retry selected" }));
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Retry selected",
        }),
      );

      await screen.findByTestId("social-bulk-retry-results");
      expect(publishProjectSocialPost).toHaveBeenCalledExactlyOnceWith({
        projectId: PROJECT_ID,
        postId: linkedInFailed.id,
        revision: linkedInFailed.revision,
      });
    },
  );

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

  it("names Preview and Post actions with the account, or this draft", () => {
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: null,
            displayName: "Sokosumi Co",
          }),
        ]}
        posts={[
          buildPost({
            id: "post-handle",
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: "Sokosumi",
              avatarUrl: null,
              subscriptionType: null,
              status: "active",
            },
          }),
          buildPost({
            id: "post-name",
            provider: "linkedin",
            socialConnection: {
              id: "connection-2",
              externalHandle: null,
              displayName: "Sokosumi Co",
              avatarUrl: null,
              subscriptionType: null,
              status: "active",
            },
          }),
          buildPost({ id: "post-untitled" }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    expect(
      within(screen.getByTestId("social-post-post-handle")).getByRole(
        "button",
        { name: "Preview @sokosumi" },
      ),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("social-post-post-handle")).getByRole(
        "button",
        { name: "Post actions for @sokosumi" },
      ),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("social-post-post-name")).getByRole("button", {
        name: "Preview Sokosumi Co",
      }),
    ).toBeVisible();
    expect(
      within(screen.getByTestId("social-post-post-untitled")).getByRole(
        "button",
        { name: "Preview this draft" },
      ),
    ).toBeVisible();
  });

  it("shows a draft's media in the platform preview, including a GIF badge", () => {
    const gif: SocialPostMediaRef = {
      pathname: "drive/users/user_1/loop.gif",
      fileUrl:
        "https://store.public.blob.vercel-storage.com/drive/users/user_1/loop.gif",
      name: "loop.gif",
      size: 1024,
      mimeType: "image/gif",
      kind: "gif",
    };
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: "Sokosumi",
              avatarUrl: null,
              subscriptionType: null,
              status: "active",
            },
            media: [IMAGE_REF, gif],
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    const draft = screen.getByTestId("social-post-post-draft");
    const preview = within(draft).getByTestId("social-post-preview");
    expect(within(preview).getByAltText("launch.png")).toBeVisible();
    expect(within(preview).getByAltText("loop.gif")).toBeVisible();
    expect(
      within(preview).getByTestId("social-post-preview-gif"),
    ).toHaveTextContent("GIF");
  });

  it("caps tall media on a draft card and pins actions under it", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection({ provider: "linkedin" })]}
        posts={[
          buildPost({
            provider: "linkedin",
            media: [IMAGE_REF],
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: "Sokosumi",
              avatarUrl: null,
              subscriptionType: null,
              status: "active",
            },
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    const draft = screen.getByTestId("social-post-post-draft");
    expect(draft).toHaveClass("h-full");
    expect(
      within(draft).getByTestId("social-post-preview-media-compact"),
    ).toHaveClass("max-h-64");
    expect(
      within(draft).getByRole("button", { name: "Preview @sokosumi" })
        .parentElement?.parentElement,
    ).toHaveClass("mt-auto");
  });

  it("opens the preview dialog from see more on a long draft", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection({ provider: "linkedin" })]}
        posts={[
          buildPost({
            provider: "linkedin",
            text: "word ".repeat(80),
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: "Sokosumi",
              avatarUrl: null,
              subscriptionType: null,
              status: "active",
            },
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "linkedin.seeMore" }));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).getByText("Post preview"),
    ).toBeVisible();
  });

  it("opens the preview dialog from a draft card", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByTestId("social-post-preview-open-post-draft"));
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      within(screen.getByRole("dialog")).getByText("Post preview"),
    ).toBeVisible();
  });

  it("keeps the reconnect warning on a draft card", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: null,
              avatarUrl: null,
              subscriptionType: null,
              status: "reauthorization_required",
            },
            connectionNeedsReconnect: true,
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    const warning = within(
      screen.getByTestId("social-post-post-draft"),
    ).getByTestId("social-post-needs-reconnect");
    expect(warning).toHaveTextContent("Account needs reconnecting");
    expect(
      within(warning).getByRole("link", { name: "Reconnect the account" }),
    ).toHaveAttribute("href", "/social?projectId=project-1&tab=accounts");
  });

  it("keeps Needs attention as compact rows", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[FAILED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const row = screen.getByTestId("social-post-post-failed");
    expect(
      within(row).queryByTestId("social-post-preview"),
    ).not.toBeInTheDocument();
    expect(within(row).getByText("Failed text")).toBeVisible();
    expect(within(row).getByTestId("social-post-status-FAILED")).toBeVisible();
  });

  it("keeps a publishing post on Drafts until it finishes", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost(), PUBLISHING_POST, SCHEDULED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Drafts 2",
      "Performance ",
    ]);
    const drafts = screen.getByTestId("social-posts-section-drafts");
    const publishing = within(drafts).getByTestId(
      "social-post-post-publishing",
    );
    expect(within(publishing).getByText("Publishing text")).toBeVisible();
    expect(
      within(publishing).getByTestId("social-post-status-PUBLISHING"),
    ).toHaveTextContent("Publishing…");
    expect(
      within(publishing).queryByRole("button", {
        name: "Post actions for this draft",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("social-post-post-scheduled"),
    ).not.toBeInTheDocument();
  });

  it("keeps a draft on Drafts while publishing and removes it once published", () => {
    const draft = buildPost();
    const { rerender } = render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[draft]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Drafts")).toHaveTextContent("Drafts 1");
    const drafts = screen.getByTestId("social-posts-section-drafts");
    const draftRow = within(drafts).getByTestId(`social-post-${draft.id}`);
    expect(within(draftRow).getByText(draft.text)).toBeVisible();

    rerender(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({ ...PUBLISHING_POST, id: draft.id, text: draft.text }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Drafts")).toHaveTextContent("Drafts 1");
    const publishing = within(drafts).getByTestId(`social-post-${draft.id}`);
    expect(within(publishing).getByText(draft.text)).toBeVisible();
    expect(
      within(publishing).getByTestId("social-post-status-PUBLISHING"),
    ).toHaveTextContent("Publishing…");

    rerender(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({ ...PUBLISHED_POST, id: draft.id, text: draft.text }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Drafts")).toHaveTextContent(/^Drafts$/);
    expect(
      within(drafts).queryByTestId(`social-post-${draft.id}`),
    ).not.toBeInTheDocument();
    expect(
      within(drafts).getByRole("heading", { name: "No drafts yet." }),
    ).toBeVisible();
  });

  it("moves a publishing post from Drafts to Needs attention when it fails", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHING_POST]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Drafts")).toHaveTextContent("Drafts 1");
    const drafts = screen.getByTestId("social-posts-section-drafts");
    expect(
      within(drafts).getByTestId(`social-post-${PUBLISHING_POST.id}`),
    ).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: /^Needs attention/ }),
    ).not.toBeInTheDocument();

    rerender(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({
            ...FAILED_POST,
            id: PUBLISHING_POST.id,
            text: PUBLISHING_POST.text,
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Drafts")).toHaveTextContent(/^Drafts$/);
    expect(
      within(drafts).queryByTestId(`social-post-${PUBLISHING_POST.id}`),
    ).not.toBeInTheDocument();
    expect(getTab("Needs attention")).toHaveTextContent("Needs attention 1");

    await openTab(user, "Needs attention");
    const attention = screen.getByTestId("social-posts-section-attention");
    const failed = within(attention).getByTestId(
      `social-post-${PUBLISHING_POST.id}`,
    );
    expect(within(failed).getByText(PUBLISHING_POST.text)).toBeVisible();
    expect(
      within(failed).getByTestId("social-post-status-FAILED"),
    ).toBeVisible();
  });

  it("prefers the account name on an attention row and keeps the handle when there is no name", async () => {
    const user = userEvent.setup();
    const named = buildPost({
      status: "FAILED",
      socialConnection: {
        id: "connection-1",
        externalHandle: "sokosumi",
        displayName: "Sokosumi HQ",
        avatarUrl: null,
        subscriptionType: null,
        status: "active",
      },
    });
    const { rerender } = render(
      <ProjectSocialPosts
        connections={[buildConnection({ displayName: "Sokosumi HQ" })]}
        posts={[named]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const namedRow = screen.getByTestId("social-post-post-draft");
    expect(within(namedRow).getByText("Sokosumi HQ")).toBeVisible();
    expect(within(namedRow).queryByText("@sokosumi")).not.toBeInTheDocument();

    rerender(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({
            status: "FAILED",
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: null,
              avatarUrl: null,
              subscriptionType: null,
              status: "active",
            },
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const handleRow = screen.getByTestId("social-post-post-draft");
    expect(within(handleRow).getByText("@sokosumi")).toBeVisible();
  });

  it("shows a named user author without the User prefix", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost({ status: "FAILED" })]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const draftRow = screen.getByTestId("social-post-post-draft");
    expect(within(draftRow).getByText("Alice")).toBeVisible();
    expect(
      within(draftRow).queryByText("User · Alice"),
    ).not.toBeInTheDocument();
    expect(within(draftRow).queryByText("User")).not.toBeInTheDocument();
  });

  it("keeps the kind prefix on coworker authors", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({
            status: "FAILED",
            creator: { kind: "coworker", id: "coworker-1", name: "Scout" },
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const draftRow = screen.getByTestId("social-post-post-draft");
    expect(within(draftRow).getByText("Coworker · Scout")).toBeVisible();
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
      "Performance ",
      "Accounts 1",
    ]);
    expect(screen.getByText("Calendar panel")).toBeVisible();
    expect(screen.getByRole("button", { name: "Page action" })).toBeVisible();

    await openTab(user, "Accounts");
    expect(screen.getByText("Accounts panel")).toBeVisible();
    expect(screen.queryByText("Calendar panel")).not.toBeInTheDocument();
  });

  it("keeps Social up with a retry when a linked post failed", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        calendar={<p>Calendar panel</p>}
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
        selectedPostFailed
      />,
    );

    expect(screen.getByText("Calendar panel")).toBeVisible();
    const failed = screen.getByTestId("social-selected-post-load-error");
    expect(failed).toHaveAttribute("role", "status");
    expect(within(failed).getByText("Couldn't open that post")).toBeVisible();
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("keeps Calendar open with a retry when the calendar failed", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        calendarFailed
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Calendar")).toHaveAttribute("aria-selected", "true");
    const failed = screen.getByTestId("social-calendar-load-error");
    expect(
      within(failed).getByText("Couldn't load the calendar"),
    ).toBeVisible();
    expect(screen.queryByText("Calendar panel")).not.toBeInTheDocument();
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("sizes the tab row like Tasks: content-width pills, action on the right", () => {
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        actions={<button type="button">Page action</button>}
        calendar={<p>Calendar panel</p>}
        connections={[buildConnection()]}
        posts={[FAILED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    const tablist = screen.getByRole("tablist");
    expect(tablist).toHaveClass(
      "w-fit",
      "bg-card-background",
      "max-sm:justify-start",
      "max-sm:overflow-x-auto",
    );
    expect(tablist).not.toHaveClass("min-h-11", "flex-1");
    expect(tablist.parentElement).toHaveClass("min-w-0", "flex-1");
    expect(tablist.parentElement?.parentElement).toHaveClass("justify-between");
    for (const tab of screen.getAllByRole("tab")) {
      expect(tab).not.toHaveClass("min-h-11");
    }
    expect(screen.getByRole("button", { name: "Page action" })).toBeVisible();
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
    expect(
      within(prompt).getByText("Posts go out from this project's accounts."),
    ).toBeVisible();
    expect(
      within(prompt).getByRole("button", {
        name: "Connect account",
      }),
    ).toHaveClass("h-11", "md:h-8");
    await user.click(
      within(prompt).getByRole("button", {
        name: "Connect account",
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

  it("counts expired accounts and asks to reconnect instead of connect", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        accountCount={2}
        accounts={<p>Accounts panel</p>}
        calendar={<p>Calendar panel</p>}
        connections={[]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    expect(getTab("Accounts")).toHaveTextContent("Accounts 2");
    expect(
      screen.queryByTestId("social-connect-prompt"),
    ).not.toBeInTheDocument();

    const prompt = screen.getByTestId("social-reconnect-prompt");
    expect(within(prompt).getByText("Reconnect to post")).toBeVisible();
    await user.click(within(prompt).getByRole("button", { name: "Reconnect" }));

    expect(getTab("Accounts")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Accounts panel")).toBeVisible();
    expect(
      screen.queryByTestId("social-reconnect-prompt"),
    ).not.toBeInTheDocument();
  });

  it("keeps Accounts open with a retry when the list failed", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        accounts={<p>Accounts panel</p>}
        accountsFailed
        calendar={<p>Calendar panel</p>}
        connections={[]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    expect(
      screen.queryByTestId("social-connect-prompt"),
    ).not.toBeInTheDocument();
    await openTab(user, "Accounts");
    const failed = screen.getByTestId("social-accounts-load-error");
    expect(within(failed).getByText("Couldn't load accounts")).toBeVisible();
    expect(screen.queryByText("Accounts panel")).not.toBeInTheDocument();
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledOnce();
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

  it("keeps Drafts open with a retry when the first page failed", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        failedSections={["drafts"]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    const drafts = screen.getByTestId("social-posts-load-error-drafts");
    expect(within(drafts).getByText("Couldn't load drafts")).toBeVisible();
    await user.click(within(drafts).getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(
      within(screen.getByTestId("social-posts-section-drafts")).queryByText(
        "No drafts yet.",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps the retry above a linked draft when the Drafts list failed", async () => {
    const user = userEvent.setup();
    const linked = buildPost({ id: "linked-draft", status: "DRAFT" });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        failedSections={["drafts"]}
        posts={[linked]}
        projectId={PROJECT_ID}
      />,
    );

    const failed = screen.getByTestId("social-posts-load-error-drafts");
    expect(failed).toHaveAttribute("role", "status");
    expect(within(failed).getByText("Couldn't load drafts")).toBeVisible();
    expect(
      within(screen.getByTestId("social-posts-drafts-grid")).getAllByRole(
        "listitem",
      ),
    ).not.toHaveLength(0);
    await user.click(within(failed).getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("keeps Needs attention so a failed first page can retry", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        failedSections={["attention"]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const attention = screen.getByTestId("social-posts-load-error-attention");
    expect(
      within(attention).getByText("Couldn't load posts that need attention"),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();
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
    expect(
      within(drafts).getByRole("heading", { name: "No drafts yet." }),
    ).toBeVisible();
    expect(
      within(drafts).getByText("Save a draft to finish later."),
    ).toBeVisible();
    expect(
      screen.queryByRole("tab", { name: /^Needs attention/ }),
    ).not.toBeInTheDocument();
  });

  it("tells a paged empty tab that more posts wait", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        nextCursors={{ drafts: "drafts-cursor" }}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    const drafts = screen.getByTestId("social-posts-section-drafts");
    expect(within(drafts).getByText("More posts are available.")).toBeVisible();
    expect(
      within(drafts).getByRole("button", { name: "Load more" }),
    ).toBeVisible();
    expect(
      within(drafts).queryByText("No drafts yet."),
    ).not.toBeInTheDocument();
  });

  it("keeps Needs attention when more pages wait with no rows yet", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        nextCursors={{ attention: "attn-cursor" }}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const attention = screen.getByTestId("social-posts-section-attention");
    expect(
      within(attention).getByText("More posts are available."),
    ).toBeVisible();
    expect(
      within(attention).getByRole("button", { name: "Load more" }),
    ).toBeVisible();
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

  it("opens the composer with a studio image and caption", () => {
    writeSocialComposePrefill(PROJECT_ID, {
      media: [IMAGE_REF],
      text: "Launch day.",
    });

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

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("Text")).toHaveValue("Launch day.");
    expect(within(dialog).getByTestId("social-post-media")).toBeVisible();
    expect(
      within(dialog).getByTestId("social-post-media").querySelectorAll("img"),
    ).toHaveLength(1);
  });

  it("forgets the studio prefill when the composer closes", async () => {
    const user = userEvent.setup();
    writeSocialComposePrefill(PROJECT_ID, { media: [IMAGE_REF] });

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

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    // The attached image counts as unsaved work, so closing asks first.
    await user.click(await screen.findByRole("button", { name: "Discard" }));

    expect(
      sessionStorage.getItem(`sokosumi.social-compose.${PROJECT_ID}`),
    ).toBe(null);
  });

  it("says why Post now is off when the draft is empty", async () => {
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
    const postNow = within(dialog).getByRole("button", { name: "Post now" });
    const trigger = postNow.parentElement;
    if (!trigger) throw new Error("Post now has no tooltip trigger");
    expect(postNow).toBeDisabled();
    expect(postNow).toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    trigger.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Add text or media.",
    );

    await user.hover(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Add text or media.",
    );
  });

  it("hides the Post now shortcut until the draft can post", async () => {
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
    const postNow = within(dialog).getByRole("button", { name: "Post now" });
    expect(postNow).toBeDisabled();
    expect(postNow.querySelector("kbd")).not.toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("Text"), "Hello");
    const enabled = within(dialog).getByRole("button", { name: "Post now" });
    expect(enabled).toBeEnabled();
    expect(enabled.querySelector("kbd")).toHaveTextContent("⌘↵");
  });

  it("says why Save draft is off when the draft is empty", async () => {
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
    const trigger = saveDraft.parentElement;
    if (!trigger) throw new Error("Save draft has no tooltip trigger");
    expect(saveDraft).toBeDisabled();
    expect(saveDraft).toHaveAttribute("aria-describedby");
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    trigger.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Add text or media.",
    );

    await user.hover(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Add text or media.",
    );
  });

  it("keeps the Save draft hint to add text or media on empty Instagram", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection({
            provider: "instagram",
            externalHandle: "sokosumi.ig",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const saveDraft = within(dialog).getByRole("button", {
      name: "Save draft",
    });
    const trigger = saveDraft.parentElement;
    if (!trigger) throw new Error("Save draft has no tooltip trigger");
    expect(saveDraft).toBeDisabled();

    trigger.focus();
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Add text or media.");
    expect(tooltip).not.toHaveTextContent(
      "Instagram requires at least one image or video.",
    );
  });

  it("names every selected network that still needs text or media", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-ig",
            provider: "instagram",
            externalHandle: "sokosumi.ig",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Instagram @sokosumi.ig" }),
    );
    const postNow = within(dialog).getByRole("button", { name: "Post now" });
    const trigger = postNow.parentElement;
    if (!trigger) throw new Error("Post now has no tooltip trigger");

    trigger.focus();
    const focused = await screen.findByRole("tooltip");
    expect(focused).toHaveTextContent("Add text or media.");
    expect(focused).toHaveTextContent(
      "Instagram requires at least one image or video.",
    );

    await user.hover(trigger);
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Add text or media.");
    expect(tooltip).toHaveTextContent(
      "Instagram requires at least one image or video.",
    );
  });

  it.each([
    [
      "instagram",
      "sokosumi.ig",
      "Instagram requires at least one image or video.",
    ],
    ["tiktok", "sokosumi.tt", "TikTok requires a video."],
    ["youtube", "sokosumi.yt", "YouTube requires a video."],
  ] as const)(
    "saves a %s draft without media and keeps the Post now hint",
    async (provider, handle, hint) => {
      const user = userEvent.setup();
      render(
        <ProjectSocialPosts
          connections={[
            buildConnection({
              provider,
              externalHandle: handle,
            }),
          ]}
          posts={[]}
          projectId={PROJECT_ID}
        />,
      );

      await user.click(screen.getByRole("button", { name: "New post" }));
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getByLabelText("Text"), "Hello");
      const saveDraft = within(dialog).getByRole("button", {
        name: "Save draft",
      });
      const postNow = within(dialog).getByRole("button", { name: "Post now" });
      expect(saveDraft).toBeEnabled();
      expect(postNow).toBeDisabled();

      const trigger = postNow.parentElement;
      if (!trigger) throw new Error("Post now has no tooltip trigger");
      trigger.focus();
      expect(await screen.findByRole("tooltip")).toHaveTextContent(hint);

      await user.click(saveDraft);
      await waitFor(() => {
        expect(createProjectSocialPost).toHaveBeenCalledWith(
          expect.objectContaining({
            text: "Hello",
            media: [],
            socialConnectionId: "connection-1",
          }),
        );
      });
    },
  );

  it("hides the Post now hint once the draft can post", async () => {
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
    await user.keyboard("Hello");
    const postNow = within(dialog).getByRole("button", { name: "Post now" });
    expect(postNow).toBeEnabled();
    expect(postNow).not.toHaveAttribute("aria-describedby");
    await user.hover(postNow);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("says why Schedule is off when a picked network still needs media", async () => {
    freezeClock();
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-ig",
            provider: "instagram",
            externalHandle: "sokosumi.ig",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Instagram @sokosumi.ig" }),
    );
    await user.type(within(dialog).getByLabelText("Text"), "Hello");
    await pickInAnHour(user, dialog);

    const schedule = within(dialog).getByRole("button", {
      name: /^Schedule for /,
    });
    const trigger = schedule.parentElement;
    if (!trigger) throw new Error("Schedule has no tooltip trigger");
    expect(schedule).toBeDisabled();
    expect(schedule).toHaveAttribute("aria-describedby");

    trigger.focus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Instagram requires at least one image or video.",
    );
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
    const tooLong = within(dialog).getByTestId("social-post-too-long");
    expect(tooLong).toHaveTextContent("Text length is over the limit.");
    expect(
      screen.getByTestId("social-post-character-count").parentElement,
    ).toContainElement(tooLong);
    expect(textarea).toHaveAttribute("aria-describedby", tooLong.id);
    expect(saveDraft).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Post now" }),
    ).toBeDisabled();

    await user.type(textarea, "{backspace}");
    expect(screen.getByTestId("social-post-character-count")).toHaveTextContent(
      "280 / 280",
    );
    expect(
      within(dialog).queryByTestId("social-post-too-long"),
    ).not.toBeInTheDocument();
    expect(saveDraft).toBeEnabled();
  });

  it("uses the Premium X account limit in the counter and platform list", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection({ subscriptionType: "Premium" }),
          buildConnection({
            id: "linkedin",
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
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "x".repeat(1000) },
    });
    expect(
      within(dialog).getByTestId("social-post-character-count"),
    ).toHaveTextContent("1000 / 25000");
    expect(
      within(dialog).queryByTestId("social-post-too-long"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
    expect(
      within(dialog).getByRole("button", { name: "Post now" }),
    ).toBeEnabled();
    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    );
    expect(
      within(dialog).getByTestId("social-post-platform-x"),
    ).toHaveTextContent("X post · 1000 / 25000");
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
  });

  it.each([
    [null, "Premium", 280, 25000],
    ["Premium", "None", 25000, 280],
  ] as const)(
    "refreshes the stored %s tier to %s after the subscription endpoint returns",
    async (stored, fresh, oldLimit, newLimit) => {
      const lookup = Promise.withResolvers<{
        data: { subscriptionType: string | null; textLimit: number };
      }>();
      getSubscriptionMock.mockReturnValueOnce(lookup.promise);
      const user = userEvent.setup();
      render(
        <ProjectSocialPosts
          connections={[buildConnection({ subscriptionType: stored })]}
          posts={[]}
          projectId={PROJECT_ID}
        />,
      );
      await user.click(screen.getByRole("button", { name: "New post" }));
      const dialog = screen.getByRole("dialog");
      fireEvent.change(within(dialog).getByLabelText("Text"), {
        target: { value: "x".repeat(5000) },
      });
      fireEvent.change(
        within(dialog).getByTestId("social-post-first-comment"),
        { target: { value: "x".repeat(5000) } },
      );
      expect(
        within(dialog).getByTestId("social-post-character-count"),
      ).toHaveTextContent(`5000 / ${oldLimit}`);
      await act(async () =>
        lookup.resolve({
          data: { subscriptionType: fresh, textLimit: newLimit },
        }),
      );
      await waitFor(() =>
        expect(
          within(dialog).getByTestId("social-post-character-count"),
        ).toHaveTextContent(`5000 / ${newLimit}`),
      );
      expect(
        within(dialog).getByTestId("social-post-first-comment-count"),
      ).toHaveTextContent(`5000 / ${newLimit}`);
      const save = within(dialog).getByRole("button", { name: "Save draft" });
      if (newLimit > 5000) expect(save).toBeEnabled();
      else expect(save).toBeDisabled();
      expect(getSubscriptionMock).toHaveBeenCalledExactlyOnceWith(
        PROJECT_ID,
        "connection-1",
      );
    },
  );

  it("refreshes an X account once per open when selected, including deselecting and reselecting", async () => {
    getSubscriptionMock.mockResolvedValue({
      data: { subscriptionType: "Basic", textLimit: 25000 },
    });
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection({
            id: "linkedin",
            provider: "linkedin",
            externalHandle: "team",
          }),
          buildConnection(),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );
    await user.click(screen.getByRole("button", { name: "New post" }));
    let dialog = screen.getByRole("dialog");
    expect(getSubscriptionMock).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    );
    await waitFor(() => expect(getSubscriptionMock).toHaveBeenCalledTimes(1));
    await user.click(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    );
    expect(getSubscriptionMock).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "New post" }));
    dialog = screen.getByRole("dialog");
    const account = within(dialog).getByRole("button", { name: "X @sokosumi" });
    if (account.getAttribute("aria-pressed") !== "true")
      await user.click(account);
    await waitFor(() => expect(getSubscriptionMock).toHaveBeenCalledTimes(2));
  });

  it("keeps the stored Premium limit silently when the refresh fails", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection({ subscriptionType: "Premium" })]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );
    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "x".repeat(5000) },
    });
    await waitFor(() => expect(getSubscriptionMock).toHaveBeenCalledOnce());
    expect(
      within(dialog).getByTestId("social-post-character-count"),
    ).toHaveTextContent("5000 / 25000");
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
    expect(toastErrorMock).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    );
    expect(getSubscriptionMock).toHaveBeenCalledOnce();
  });

  it("counts URLs, CJK, and emoji by X weights in the text, reply, and platform counters", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "linkedin",
            provider: "linkedin",
            externalHandle: "team",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );
    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const text = `${"界".repeat(100)} 👨‍👩‍👧‍👦 https://example.com/${"p".repeat(200)}`;
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: text },
    });
    fireEvent.change(within(dialog).getByTestId("social-post-first-comment"), {
      target: { value: text },
    });
    expect(
      within(dialog).getByTestId("social-post-character-count"),
    ).toHaveTextContent("227 / 280");
    expect(
      within(dialog).getByTestId("social-post-first-comment-count"),
    ).toHaveTextContent("227 / 280");
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn @team" }),
    );
    expect(
      within(dialog).getByTestId("social-post-platform-x"),
    ).toHaveTextContent("227 / 280");
    expect(
      within(dialog).getByTestId("social-post-platform-linkedin"),
    ).toHaveTextContent(`${text.length} / 3000`);
  });

  it("closes an empty composer without asking", async () => {
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
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["Text", "First comment"])(
    "asks before discarding an unsaved new post's %s",
    async (fieldLabel) => {
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
      await user.type(within(dialog).getByLabelText(fieldLabel), "Unsaved");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      const alert = screen.getByRole("alertdialog");
      expect(within(alert).getByText("Discard changes?")).toBeVisible();
      expect(
        within(alert).getByText("Your changes will be lost."),
      ).toBeVisible();
      expect(dialog).toBeVisible();

      await user.click(
        within(alert).getByRole("button", { name: "Keep editing" }),
      );
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(within(dialog).getByLabelText(fieldLabel)).toHaveValue("Unsaved");

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await user.click(
        within(screen.getByRole("alertdialog")).getByRole("button", {
          name: "Discard",
        }),
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );

  it("closes after a successful save without asking", async () => {
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
    await user.type(within(dialog).getByLabelText("Text"), "Saved draft");
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalled();
    });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["Text", "First comment"])(
    "asks before discarding an edited post's %s",
    async (fieldLabel) => {
      const user = userEvent.setup();
      render(
        <ProjectSocialPosts
          connections={[buildConnection()]}
          posts={[buildPost()]}
          projectId={PROJECT_ID}
        />,
      );

      await openTab(user, "Drafts");
      await openRowMenu(user, "post-draft");
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));

      const dialog = screen.getByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      await openRowMenu(user, "post-draft");
      await user.click(screen.getByRole("menuitem", { name: "Edit" }));
      const editor = screen.getByRole("dialog");
      fireEvent.change(within(editor).getByLabelText(fieldLabel), {
        target: { value: "Changed draft" },
      });
      await user.click(within(editor).getByRole("button", { name: "Cancel" }));
      expect(screen.getByRole("alertdialog")).toBeVisible();
      expect(editor).toBeVisible();
    },
  );

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
      within(accounts).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveClass("h-11", "md:h-8");
    expect(
      within(accounts).getByRole("button", {
        name: "LinkedIn @sokosumi-co",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("puts the editor above the preview on a phone", async () => {
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
      within(dialog).getByTestId("social-post-composer-editor"),
    ).toHaveClass("order-1");
    expect(within(dialog).getByRole("complementary")).toHaveClass("order-2");
    expect(within(dialog).getByTestId("social-post-composer-when")).toHaveClass(
      "order-3",
    );
  });

  it("remembers the accounts a New post used last time", async () => {
    const user = userEvent.setup();
    const connections = [
      buildConnection(),
      buildConnection({
        id: "connection-2",
        provider: "linkedin",
        externalHandle: "sokosumi-co",
      }),
    ];
    const { rerender } = render(
      <ProjectSocialPosts
        connections={connections}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const first = screen.getByRole("dialog");
    await user.click(
      within(first).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    );
    await user.type(within(first).getByLabelText("Text"), "Hello both");
    await user.click(within(first).getByRole("button", { name: "Save draft" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    rerender(
      <ProjectSocialPosts
        connections={connections}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );
    await user.click(screen.getByRole("button", { name: "New post" }));
    const again = screen.getByRole("dialog");
    const accounts = within(again).getByRole("group", { name: "Post to" });
    expect(
      within(accounts).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(accounts).getByRole("button", {
        name: "LinkedIn @sokosumi-co",
      }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("drops a remembered account that is no longer connected", async () => {
    const user = userEvent.setup();
    writeRememberedComposerAccounts("org_1", PROJECT_ID, [
      "connection-1",
      "connection-2",
    ]);
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
            status: "disconnected",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const accounts = within(screen.getByRole("dialog")).getByRole("group", {
      name: "Post to",
    });
    expect(
      within(accounts).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(accounts).getByRole("button", {
        name: "LinkedIn @sokosumi-co",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("falls back to the first account when nothing remembered still connects", async () => {
    const user = userEvent.setup();
    writeRememberedComposerAccounts("org_1", PROJECT_ID, ["gone"]);
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
    const accounts = within(screen.getByRole("dialog")).getByRole("group", {
      name: "Post to",
    });
    expect(
      within(accounts).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(accounts).getByRole("button", {
        name: "LinkedIn @sokosumi-co",
      }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps an edited post on its own account even when another set is remembered", async () => {
    const user = userEvent.setup();
    writeRememberedComposerAccounts("org_1", PROJECT_ID, [
      "connection-1",
      "connection-2",
    ]);
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
        posts={[
          buildPost({
            socialConnection: {
              id: "connection-2",
              externalHandle: "sokosumi-co",
              displayName: null,
              avatarUrl: null,
              subscriptionType: null,
              status: "active",
            },
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Drafts");
    await openRowMenu(user, "post-draft");
    await user.click(screen.getByRole("menuitem", { name: "Edit" }));
    const accounts = within(screen.getByRole("dialog")).getByRole("group", {
      name: "Account",
    });
    expect(
      within(accounts).getByRole("button", {
        name: "LinkedIn @sokosumi-co",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(accounts).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("names the missing account next to the chips when none are selected", async () => {
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
    await user.click(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    );

    const accounts = within(dialog).getByRole("group", { name: "Post to" });
    expect(accounts).toHaveAttribute("aria-invalid", "true");
    expect(
      within(accounts).getByTestId("social-post-pick-account"),
    ).toHaveTextContent("Pick an account to post to.");
    expect(
      within(dialog).getByRole("button", { name: "Post now" }),
    ).toBeDisabled();
  });

  it("labels composer chips with the account name when it has one", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection({ displayName: "Sokosumi HQ" }),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
            displayName: null,
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const accounts = within(screen.getByRole("dialog")).getByRole("group", {
      name: "Post to",
    });
    expect(
      within(accounts).getByRole("button", { name: "X Sokosumi HQ" }),
    ).toBeVisible();
    expect(
      within(accounts).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    ).toBeVisible();
    expect(
      within(accounts).queryByRole("button", { name: "X @sokosumi" }),
    ).not.toBeInTheDocument();
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
    // Shared text still goes to both until an account is edited on its own.
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByTestId("social-post-text-for-account"),
    ).toHaveTextContent("Text for this account");
  });

  it("saves different text and the first comment for each picked account", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost)
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({ id: "post-x", text: "Short for X" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({
          id: "post-li",
          provider: "linkedin",
          text: "Longer for LinkedIn",
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
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "Short for X" },
    });
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview as LinkedIn @sokosumi-co",
      }),
    );
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "Longer for LinkedIn" },
    });
    fireEvent.change(within(dialog).getByLabelText("First comment"), {
      target: { value: " #launch " },
    });
    expect(within(dialog).getByTestId("social-post-preview")).toHaveTextContent(
      "Longer for LinkedIn",
    );
    expect(
      within(dialog).getByTestId("social-post-platform-x"),
    ).toHaveTextContent("X post · 11 / 280");
    expect(
      within(dialog).getByTestId("social-post-platform-linkedin"),
    ).toHaveTextContent("LinkedIn post · 19 / 3000");

    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );
    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledTimes(2);
    });
    expect(createProjectSocialPost).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        projectId: PROJECT_ID,
        text: "Short for X",
        firstComment: "#launch",
        socialConnectionId: "connection-1",
      }),
    );
    expect(createProjectSocialPost).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        projectId: PROJECT_ID,
        text: "Longer for LinkedIn",
        firstComment: "#launch",
        socialConnectionId: "connection-2",
      }),
    );
  });

  it("lets a long LinkedIn caption save after X is shortened", async () => {
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
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "a".repeat(280) },
    });
    expect(screen.getByTestId("social-post-character-count")).toHaveTextContent(
      "280 / 280",
    );
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview as LinkedIn @sokosumi-co",
      }),
    );
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "a".repeat(300) },
    });
    expect(screen.getByTestId("social-post-character-count")).toHaveTextContent(
      "300 / 3000",
    );
    expect(
      within(dialog).getByTestId("social-post-platform-x"),
    ).toHaveTextContent("X post · 280 / 280");
    expect(
      within(dialog).getByTestId("social-post-platform-linkedin"),
    ).toHaveTextContent("LinkedIn post · 300 / 3000");
    expect(
      within(dialog).queryByTestId("social-post-too-long"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
  });

  it("keeps each connected network's limit after every account is deselected", async () => {
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
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    );
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "a".repeat(300) },
    });

    expect(
      within(dialog).getByTestId("social-post-platform-x"),
    ).toHaveTextContent("X post · 300 / 280");
    expect(
      within(dialog).getByTestId("social-post-platform-linkedin"),
    ).toHaveTextContent("LinkedIn post · 300 / 3000");
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
        "Publishing failed: The platform rejected this post.",
      );
    });
    expect(toastErrorMock).not.toHaveBeenCalledWith(
      "Publishing failed: X rejected the post",
    );
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
      expect(toastErrorMock).toHaveBeenCalledWith(
        "@sokosumi-co — LinkedIn refused it",
      );
    });
    // X is live already, so it leaves the selection.
    expect(
      within(dialog).getByRole("button", { name: "X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      within(dialog).getByRole("button", { name: "LinkedIn @sokosumi-co" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("names every account when Post now fails for more than one", async () => {
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost)
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({ id: "post-x", text: "Hi", revision: 0 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        value: buildPost({
          id: "post-li",
          provider: "linkedin",
          text: "Hi",
          revision: 0,
        }),
      });
    vi.mocked(publishProjectSocialPost)
      .mockResolvedValueOnce({
        ok: true,
        value: {
          ...FAILED_POST,
          id: "post-x",
          lastError: "X rejected the post",
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          ...FAILED_POST,
          id: "post-li",
          provider: "linkedin",
          lastError: "LinkedIn rate limited",
          lastAttempt: {
            ...FAILED_POST.lastAttempt!,
            errorKind: "rate_limited",
          },
        },
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
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Publishing failed: @sokosumi — The platform rejected this post.; @sokosumi-co — Rate limited. Try again later.",
      );
    });
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

  it("offers best-time chips from this account's Performance hours", async () => {
    freezeClock();
    const user = userEvent.setup();
    const suggested = new Date(2026, 8, 20, 14, 0);
    getSuggestedTimesMock.mockResolvedValue({ data: { hours: [14, 18] } });
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
    const chips = await waitFor(() => {
      const found = within(dialog).getAllByRole("button", {
        name: /^Best /,
      });
      expect(found).toHaveLength(2);
      return found;
    });
    await user.type(within(dialog).getByLabelText("Text"), "Peak hour");
    await user.click(chips[0]);
    await user.click(
      within(dialog).getByRole("button", { name: /^Schedule for / }),
    );

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith(
        expect.objectContaining({ scheduledAt: suggested.toISOString() }),
      );
    });
    expect(getSuggestedTimesMock).toHaveBeenCalledWith(
      PROJECT_ID,
      "connection-1",
      expect.objectContaining({ timezone: expect.any(String) }),
    );
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
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Connect account",
      }),
    ).toHaveClass("h-11", "md:h-8");
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

  it("saves a first comment with the draft", async () => {
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
    await user.type(
      within(dialog).getByTestId("social-post-first-comment"),
      "#launch",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Save draft" }),
    );

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        text: "Fresh",
        firstComment: "#launch",
        media: [],
        socialConnectionId: "connection-1",
      });
    });
  });

  it("caps the first comment by the strictest selected network", async () => {
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
    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview as LinkedIn @sokosumi-co",
      }),
    );
    fireEvent.change(within(dialog).getByTestId("social-post-first-comment"), {
      target: { value: "x".repeat(281) },
    });

    expect(
      within(dialog).getByTestId("social-post-first-comment-count"),
    ).toHaveTextContent("281 / 280");
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeDisabled();
  });

  it("hides first comment when only TikTok is selected", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection({
            id: "connection-tiktok",
            provider: "tiktok",
            externalHandle: "sokosumi",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).queryByTestId("social-post-first-comment"),
    ).not.toBeInTheDocument();
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

  it("keeps the network logo on a composer chip without a photo", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const chip = within(screen.getByRole("dialog")).getByRole("button", {
      name: "X @sokosumi",
    });
    expect(within(chip).getByTestId("social-post-account-logo")).toBeVisible();
    expect(
      within(chip).queryByTestId("social-post-account-photo"),
    ).not.toBeInTheDocument();
    expect(
      within(chip).queryByTestId("social-post-account-logo-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows the account photo with a network logo badge", async () => {
    const restore = stubLoadedImage();
    const photo =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='%23111'/></svg>";
    try {
      const user = userEvent.setup();
      render(
        <ProjectSocialPosts
          connections={[buildConnection({ avatarUrl: photo })]}
          posts={[]}
          projectId={PROJECT_ID}
        />,
      );

      await user.click(screen.getByRole("button", { name: "New post" }));
      const chip = within(screen.getByRole("dialog")).getByRole("button", {
        name: "X @sokosumi",
      });
      await waitFor(() => {
        expect(
          within(chip).getByTestId("social-post-account-photo"),
        ).toHaveAttribute("src", photo);
      });
      expect(
        within(chip).getByTestId("social-post-account-logo"),
      ).toBeVisible();
      expect(
        within(chip).getByTestId("social-post-account-logo-badge"),
      ).toBeVisible();
    } finally {
      restore();
    }
  });

  it("falls back to the network logo when the account photo fails", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection({ avatarUrl: "https://example.invalid/missing.png" }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const chip = within(screen.getByRole("dialog")).getByRole("button", {
      name: "X @sokosumi",
    });
    await waitFor(() => {
      expect(
        within(chip).queryByTestId("social-post-account-photo"),
      ).not.toBeInTheDocument();
    });
    expect(within(chip).getByTestId("social-post-account-logo")).toBeVisible();
    expect(
      within(chip).queryByTestId("social-post-account-logo-badge"),
    ).not.toBeInTheDocument();
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

  it("marks a GIF thumb on the queue row", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({ id: "post-gif", status: "FAILED", media: [GIF_REF] }),
        ]}
        projectId={PROJECT_ID}
      />,
      "?tab=attention",
    );

    const row = screen.getByTestId("social-post-post-gif");
    expect(within(row).getByTestId("social-post-media-gif")).toHaveTextContent(
      "GIF",
    );
  });

  it("does not mark a still image as a GIF", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({ id: "post-img", status: "FAILED", media: [IMAGE_REF] }),
        ]}
        projectId={PROJECT_ID}
      />,
      "?tab=attention",
    );

    expect(
      within(screen.getByTestId("social-post-post-img")).queryByTestId(
        "social-post-media-gif",
      ),
    ).not.toBeInTheDocument();
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
    expect(
      within(dialog).getByRole("button", { name: "Add from Drive" }),
    ).toHaveClass("h-11", "md:h-8");
    expect(within(dialog).getByRole("button", { name: "Upload" })).toHaveClass(
      "h-11",
      "md:h-8",
    );
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

  it("uploads every chosen file in one pick", async () => {
    uploadDriveFileMock
      .mockResolvedValueOnce({
        pathname: "drive/users/user_1/one.png",
        fileUrl:
          "https://store.public.blob.vercel-storage.com/drive/users/user_1/one.png",
      })
      .mockResolvedValueOnce({
        pathname: "drive/users/user_1/two.png",
        fileUrl:
          "https://store.public.blob.vercel-storage.com/drive/users/user_1/two.png",
      });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const input = dialog.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    const one = new File(["a"], "one.png", { type: "image/png" });
    const two = new File(["b"], "two.png", { type: "image/png" });
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(one);
    dataTransfer.items.add(two);

    await act(async () => {
      fireEvent.change(input as HTMLInputElement, {
        target: { files: dataTransfer.files },
      });
    });

    await waitFor(() => {
      expect(uploadDriveFileMock).toHaveBeenCalledTimes(2);
    });
    expect(
      within(dialog).getByTestId("social-post-media").querySelectorAll("img"),
    ).toHaveLength(2);
  });

  it("attaches a pasted image and a dropped image", async () => {
    uploadDriveFileMock
      .mockResolvedValueOnce({
        pathname: "drive/users/user_1/pasted.png",
        fileUrl:
          "https://store.public.blob.vercel-storage.com/drive/users/user_1/pasted.png",
      })
      .mockResolvedValueOnce({
        pathname: "drive/users/user_1/dropped.png",
        fileUrl:
          "https://store.public.blob.vercel-storage.com/drive/users/user_1/dropped.png",
      });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    const surface = within(dialog).getByTestId("social-post-composer-surface");
    const pasted = new File(["p"], "pasted.png", { type: "image/png" });
    const dropped = new File(["d"], "dropped.png", { type: "image/png" });

    await act(async () => {
      fireEvent.paste(surface, {
        clipboardData: {
          items: [{ kind: "file", getAsFile: () => pasted }],
        },
      });
    });
    await waitFor(() => {
      expect(uploadDriveFileMock).toHaveBeenCalledWith(pasted, {
        scope: "org",
        organizationId: "org_1",
      });
    });

    await act(async () => {
      fireEvent.drop(surface, {
        dataTransfer: {
          types: ["Files"],
          files: [dropped],
        },
      });
    });
    await waitFor(() => {
      expect(uploadDriveFileMock).toHaveBeenCalledTimes(2);
    });
    expect(
      within(dialog).getByTestId("social-post-media").querySelectorAll("img"),
    ).toHaveLength(2);
  });

  it("shows a drop hint while a file is held over the composer", async () => {
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
    const surface = within(dialog).getByTestId("social-post-composer-surface");
    fireEvent.dragEnter(surface, {
      dataTransfer: { types: ["Files"], files: [] },
    });
    expect(within(dialog).getByText("Drop files to attach")).toBeVisible();
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
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it.each([
    ["UTC", "2026-10-01"],
    ["America/Los_Angeles", "2026-09-30"],
    ["Asia/Tokyo", "2026-10-01"],
  ])(
    "opens the scheduled day in calendar timezone %s",
    async (timezone, expectedDate) => {
      freezeClock();
      const user = userEvent.setup();
      const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
      vi.mocked(createProjectSocialPost).mockResolvedValue({
        ok: true,
        value: {
          ...SCHEDULED_POST,
          scheduledAt: new Date("2026-10-01T00:30:00.000Z"),
        },
      });
      renderUi(
        <TestQueryProvider>
          <NuqsTestingAdapter
            onUrlUpdate={onUrlUpdate}
            searchParams={`?tab=drafts&timezone=${timezone}`}
          >
            <SocialComposeProvider>
              <NewPostButton />
              <ProjectSocialPosts
                calendar={<div data-testid="social-calendar" />}
                connections={[buildConnection()]}
                posts={[]}
                projectId={PROJECT_ID}
              />
            </SocialComposeProvider>
          </NuqsTestingAdapter>
        </TestQueryProvider>,
      );

      await user.click(screen.getByRole("button", { name: "New post" }));
      const dialog = screen.getByRole("dialog");
      await user.type(within(dialog).getByLabelText("Text"), "Scheduled text");
      await pickInAnHour(user, dialog);
      const schedule = within(dialog).getByRole("button", {
        name: /^Schedule/,
      });
      await waitFor(() => expect(schedule).toBeEnabled());
      await user.click(schedule);

      await waitFor(() => {
        expect(onUrlUpdate).toHaveBeenCalled();
      });
      expect(
        onUrlUpdate.mock.calls.some(
          ([event]) => event.searchParams.get("date") === expectedDate,
        ),
      ).toBe(true);
      expect(getTab("Calendar")).toHaveAttribute("aria-selected", "true");
    },
  );

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
        firstComment: "",
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
              subscriptionType: null,
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

  it("keeps Edit and Reschedule on the preview footer, not in the preview menu", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Edit" })).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: /^Reschedule/ }),
    ).toBeVisible();

    await user.click(
      within(dialog).getByRole("button", {
        name: "Post actions for @sokosumi",
      }),
    );
    expect(screen.getByRole("menuitem", { name: "Post now" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Cancel post" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Reschedule" }),
    ).not.toBeInTheDocument();
  });

  it("hides the preview menu when only Edit or Schedule would remain", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[{ ...FAILED_POST, canCancel: false, canDuplicate: false }]}
        projectId={PROJECT_ID}
        selectedPostId="post-failed"
      />,
    );

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Retry" })).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: /^Reschedule/ }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: /^Post actions/ }),
    ).not.toBeInTheDocument();
  });

  it("switches the live preview between selected accounts", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[
          buildConnection(),
          buildConnection({
            id: "connection-2",
            provider: "linkedin",
            externalHandle: "sokosumi-co",
            displayName: "Sokosumi Co",
          }),
        ]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn Sokosumi Co" }),
    );
    await user.type(within(dialog).getByLabelText("Text"), "Hello both");

    const preview = within(dialog).getByTestId("social-post-preview");
    expect(preview).toHaveAttribute("data-provider", "x");
    expect(
      within(dialog).getByRole("button", { name: "Preview as X @sokosumi" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      within(dialog).getByRole("button", { name: "Preview as X @sokosumi" }),
    ).toHaveClass("h-11", "md:h-8");
    expect(
      within(dialog).getByRole("button", {
        name: "Preview as LinkedIn @sokosumi-co",
      }),
    ).toHaveClass("h-11", "md:h-8");

    await user.click(
      within(dialog).getByRole("button", {
        name: "Preview as LinkedIn @sokosumi-co",
      }),
    );
    expect(preview).toHaveAttribute("data-provider", "linkedin");
    expect(within(preview).getByText("Sokosumi Co")).toBeVisible();
    expect(
      within(dialog).getByRole("button", {
        name: "Preview as LinkedIn @sokosumi-co",
      }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      within(dialog).getByRole("button", { name: "LinkedIn Sokosumi Co" }),
    );
    expect(
      within(dialog).queryByTestId("social-post-preview-accounts"),
    ).not.toBeInTheDocument();
    expect(preview).toHaveAttribute("data-provider", "x");
  });

  it("badges the network logo on preview account chips with photos", async () => {
    const restore = stubLoadedImage();
    const photo =
      "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='8' height='8'><rect width='8' height='8' fill='%23111'/></svg>";
    try {
      const user = userEvent.setup();
      render(
        <ProjectSocialPosts
          connections={[
            buildConnection({ avatarUrl: photo }),
            buildConnection({
              id: "connection-2",
              provider: "linkedin",
              externalHandle: "sokosumi-co",
              displayName: "Sokosumi Co",
              avatarUrl: photo,
            }),
          ]}
          posts={[]}
          projectId={PROJECT_ID}
        />,
      );

      await user.click(screen.getByRole("button", { name: "New post" }));
      const dialog = screen.getByRole("dialog");
      await user.click(
        within(dialog).getByRole("button", { name: "LinkedIn Sokosumi Co" }),
      );
      await user.type(within(dialog).getByLabelText("Text"), "Hello both");

      const chip = within(dialog).getByRole("button", {
        name: "Preview as X @sokosumi",
      });
      await waitFor(() => {
        expect(
          within(chip).getByTestId("social-post-account-photo"),
        ).toHaveAttribute("src", photo);
      });
      expect(
        within(chip).getByTestId("social-post-account-logo"),
      ).toBeVisible();
      expect(
        within(chip).getByTestId("social-post-account-logo-badge"),
      ).toBeVisible();
    } finally {
      restore();
    }
  });

  it("reschedules a scheduled post from the preview", async () => {
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

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Reschedule/,
      }),
    );

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

  it("names a time that is too soon next to When", async () => {
    freezeClock();
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          {
            ...SCHEDULED_POST,
            scheduledAt: new Date(NOW.getTime() + 30_000),
          },
        ]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Reschedule/,
      }),
    );
    const dialog = screen.getByRole("dialog");
    const when = within(dialog)
      .getByRole("heading", { name: "When" })
      .closest("section");
    if (!when) throw new Error("When section missing");
    expect(
      within(when).getByTestId("social-post-scheduled-too-soon"),
    ).toHaveTextContent("Choose a time at least one minute from now.");
    expect(
      within(dialog).getByRole("button", { name: /^Reschedule/ }),
    ).toBeDisabled();
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

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit" }),
    );
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
    expect(refreshMock).toHaveBeenCalledOnce();
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
              subscriptionType: null,
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
    expect(
      within(warning).getByRole("link", { name: "Reconnect the account" }),
    ).toHaveAttribute("href", `/social?projectId=${PROJECT_ID}&tab=accounts`);
  });

  it("links reconnect from a list row to the project's Accounts tab", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          {
            ...FAILED_POST,
            socialConnection: {
              id: "connection-1",
              externalHandle: "sokosumi",
              displayName: null,
              avatarUrl: null,
              subscriptionType: null,
              status: "reauthorization_required",
            },
            connectionNeedsReconnect: true,
          },
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");

    const warning = screen.getByTestId("social-post-needs-reconnect");
    expect(warning).toHaveTextContent("Account needs reconnecting");
    expect(
      within(warning).getByRole("link", { name: "Reconnect the account" }),
    ).toHaveAttribute("href", "/social?projectId=project-1&tab=accounts");
  });

  it("sends preview-only connect to the project's Accounts tab", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
        previewOnly
      />,
    );

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Reschedule/,
      }),
    );

    await user.click(
      within(screen.getByTestId("social-post-composer")).getByRole("button", {
        name: "Connect account",
      }),
    );

    expect(pushMock).toHaveBeenCalledWith(
      "/social?projectId=project-1&tab=accounts",
    );
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
      within(row).getByText("The platform rejected this post."),
    ).toBeVisible();
    expect(
      within(row).queryByText("X rejected the post (403 forbidden)"),
    ).not.toBeInTheDocument();
    expect(
      within(row).getByText(
        createTestFormatter().dateTime(
          new Date("2026-09-10T10:05:00.000Z"),
          "dateTime",
        ),
      ),
    ).toBeVisible();
    await user.hover(within(row).getByRole("button", { name: "UTC" }));
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Coordinated Universal Time",
    );
    expect(within(row).queryByText(/10:00/)).not.toBeInTheDocument();

    expect(within(row).getByText("3 attempts")).toBeVisible();
    expect(within(row).getByText("Failed")).toBeVisible();
    // Retry is the one thing left to do, so it sits on the row.
    expect(within(row).getByRole("button", { name: "Retry" })).toHaveClass(
      "h-11",
      "md:h-8",
    );
    expect(
      within(row).getByRole("button", { name: "Preview @sokosumi" }),
    ).toBeVisible();
    expect(
      within(row).getByRole("button", {
        name: "Post actions for @sokosumi",
      }),
    ).toBeVisible();

    await openRowMenu(user, "post-failed");
    expect(screen.getByRole("menuitem", { name: "Reschedule" })).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByRole("menuitem", { name: "Dismiss" })).toHaveClass(
      "min-h-11",
    );
    expect(
      screen.queryByRole("menuitem", { name: "Cancel post" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Post now" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Edit" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("menuitem", { name: "Duplicate as draft" }),
    ).toBeVisible();
  });

  it("dismisses a FAILED post after confirmation and leaves Needs attention", async () => {
    const user = userEvent.setup();
    vi.mocked(cancelProjectSocialPost).mockResolvedValue({
      ok: true,
      value: {
        ...FAILED_POST,
        status: "CANCELED",
        canceledAt: new Date("2026-09-15T12:00:00.000Z"),
        revision: 6,
        canEdit: false,
        canSchedule: false,
        canCancel: false,
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
    await openRowMenu(user, "post-failed");
    await user.click(screen.getByRole("menuitem", { name: "Dismiss" }));
    expect(cancelProjectSocialPost).not.toHaveBeenCalled();

    const alert = screen.getByRole("alertdialog");
    expect(
      within(alert).getByRole("heading", { name: "Dismiss this post?" }),
    ).toBeVisible();
    expect(within(alert).getByText("It leaves Needs attention.")).toBeVisible();
    expect(
      within(alert).queryByRole("heading", { name: "Cancel this post?" }),
    ).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(cancelProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-failed",
        revision: 5,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post dismissed.");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: /^Needs attention/ }),
    ).not.toBeInTheDocument();
    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");
    expect(
      screen.queryByTestId("social-post-post-failed"),
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
            lastAttempt: {
              ...FAILED_POST.lastAttempt!,
              outcome: "missed",
              errorKind: null,
            },
          },
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const row = screen.getByTestId("social-post-post-missed");
    expect(within(row).getByText("Missed the scheduled time.")).toBeVisible();
    expect(
      within(row).queryByText("Scheduled time passed more than an hour ago"),
    ).not.toBeInTheDocument();
    expect(within(row).getByText("Missed")).toBeVisible();
    expect(within(row).getByText("Failed Sep 10, 10:05 AM")).toBeVisible();
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
      within(alert).getByRole("heading", { name: "Retry this post?" }),
    ).toBeVisible();
    expect(within(alert).getByText("The post goes out now.")).toBeVisible();
    expect(
      within(alert).queryByRole("heading", {
        name: "Post this now?",
      }),
    ).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(publishProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-failed",
        revision: 5,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post published.");
    expect(refreshMock).toHaveBeenCalledOnce();
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

  it("stays on Needs attention after a retry when other posts still need it", async () => {
    const user = userEvent.setup();
    const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>();
    const secondFailed = {
      ...FAILED_POST,
      id: "post-failed-2",
      text: "Second failure",
      revision: 3,
    };
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
    renderUi(
      <TestQueryProvider>
        <NuqsTestingAdapter
          onUrlUpdate={onUrlUpdate}
          searchParams="?tab=attention&date=2026-11-03&timezone=UTC"
        >
          <SocialComposeProvider>
            <ProjectSocialPosts
              calendar={<div data-testid="social-calendar" />}
              connections={[buildConnection()]}
              posts={[FAILED_POST, secondFailed]}
              projectId={PROJECT_ID}
            />
          </SocialComposeProvider>
        </NuqsTestingAdapter>
      </TestQueryProvider>,
    );

    expect(getTab("Needs attention")).toHaveAttribute("aria-selected", "true");
    await user.click(
      within(screen.getByTestId("social-post-post-failed")).getByRole(
        "button",
        { name: "Retry" },
      ),
    );
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Retry",
      }),
    );

    await waitFor(() => {
      expect(publishProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-failed",
        revision: 5,
      });
    });
    expect(getTab("Needs attention")).toHaveAttribute("aria-selected", "true");
    expect(
      onUrlUpdate.mock.calls.some(
        ([event]) => event.searchParams.get("date") !== "2026-11-03",
      ),
    ).toBe(false);
    expect(screen.getByTestId("social-post-post-failed-2")).toBeVisible();
    expect(
      screen.queryByTestId("social-post-post-failed"),
    ).not.toBeInTheDocument();
  });

  it("retries selected failed posts once and lists each result", async () => {
    const user = userEvent.setup();
    const secondFailed = {
      ...FAILED_POST,
      id: "post-failed-2",
      text: "Second failure",
      revision: 3,
      lastAttemptAt: new Date("2026-08-01T10:00:00.000Z"),
      updatedAt: new Date("2026-08-01T10:00:00.000Z"),
    };
    vi.mocked(publishProjectSocialPost).mockImplementation(async (input) => {
      if (input.postId === "post-failed") {
        return {
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
        };
      }
      return {
        ok: true,
        value: {
          ...secondFailed,
          lastError: "X is unavailable",
          attemptCount: 4,
          revision: 4,
        },
      };
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[FAILED_POST, secondFailed]}
        projectId={PROJECT_ID}
      />,
      "?tab=attention",
    );

    expect(getTab("Needs attention")).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("button", { name: "Retry selected" }),
    ).toBeDisabled();

    await user.click(screen.getByTestId("social-post-select-post-failed"));
    await user.click(screen.getByTestId("social-post-select-post-failed-2"));
    expect(screen.getByText("2 selected")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry selected" }));

    const alert = screen.getByRole("alertdialog");
    expect(
      within(alert).getByRole("heading", { name: "Retry these posts now?" }),
    ).toBeVisible();
    expect(publishProjectSocialPost).not.toHaveBeenCalled();
    await user.click(
      within(alert).getByRole("button", { name: "Retry selected" }),
    );

    await waitFor(() => {
      expect(publishProjectSocialPost).toHaveBeenCalledTimes(2);
    });
    expect(publishProjectSocialPost).toHaveBeenNthCalledWith(1, {
      projectId: PROJECT_ID,
      postId: "post-failed",
      revision: 5,
    });
    expect(publishProjectSocialPost).toHaveBeenNthCalledWith(2, {
      projectId: PROJECT_ID,
      postId: "post-failed-2",
      revision: 3,
    });
    expect(toastSuccessMock).not.toHaveBeenCalled();

    const results = await screen.findByTestId("social-bulk-retry-results");
    expect(
      within(results).getByTestId("social-bulk-retry-result-post-failed"),
    ).toHaveTextContent("Published");
    expect(
      within(results).getByTestId("social-bulk-retry-result-post-failed-2"),
    ).toHaveTextContent("The platform rejected this post.");
    expect(
      within(results).queryByText("X is unavailable"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("social-post-post-failed-2")).toBeInTheDocument();
    expect(
      screen.queryByTestId("social-post-post-failed"),
    ).not.toBeInTheDocument();
  });

  it("does not offer bulk retry when a failed post cannot publish now", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[{ ...FAILED_POST, canPublishNow: false }]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    expect(screen.queryByTestId("social-bulk-retry")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("social-post-select-post-failed"),
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
    await user.click(screen.getByRole("menuitem", { name: "Post now" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Post now",
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
      "Publishing failed: Couldn't publish. Open the post for details.",
    );
    expect(toastSuccessMock).not.toHaveBeenCalled();
    // The failed post takes the list with it to Needs attention.
    expect(getTab("Needs attention")).toHaveAttribute("aria-selected", "true");
    const attention = screen.getByTestId("social-posts-section-attention");
    const row = within(attention).getByTestId("social-post-post-draft");
    expect(
      within(row).getByText("Couldn't publish. Open the post for details."),
    ).toBeVisible();
    expect(within(row).queryByText("X is unavailable")).not.toBeInTheDocument();

    await openTab(user, "Drafts");
    expect(screen.getByText("No drafts yet.")).toBeVisible();
  });

  it("hides Publish now on a TikTok draft that still needs a video", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection({ provider: "tiktok" })]}
        posts={[
          buildPost({
            id: "post-tiktok-draft",
            provider: "tiktok",
            text: "Caption only",
            media: [],
            canPublishNow: false,
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Drafts");
    await openRowMenu(user, "post-tiktok-draft");
    expect(
      screen.queryByRole("menuitem", { name: "Publish now" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Schedule" })).toBeVisible();
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
    await user.click(screen.getByRole("menuitem", { name: "Post now" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Post now",
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
      within(dialog).getByRole("button", { name: /^Post actions/ }),
    ).toBeVisible();
  });

  it("duplicates a published post into a draft and switches to Drafts", async () => {
    const user = userEvent.setup();
    const draft = buildPost({
      id: "post-copy",
      text: PUBLISHED_POST.text,
      canEdit: true,
      canSchedule: true,
      canCancel: true,
      canPublishNow: true,
      canDuplicate: false,
    });
    vi.mocked(duplicateProjectSocialPost).mockResolvedValue({
      ok: true,
      value: draft,
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHED_POST]}
        projectId={PROJECT_ID}
        selectedPostId="post-published"
      />,
    );

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Post actions/,
      }),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Duplicate as draft" }),
    );

    await waitFor(() => {
      expect(duplicateProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-published",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Draft created.");
    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("social-post-post-copy")).toBeVisible();
    expect(
      within(screen.getByTestId("social-post-post-copy")).getByText(
        "Published text",
      ),
    ).toBeVisible();
  });

  it("duplicates a failed post from Needs attention", async () => {
    const user = userEvent.setup();
    vi.mocked(duplicateProjectSocialPost).mockResolvedValue({
      ok: true,
      value: buildPost({
        id: "post-failed-copy",
        text: FAILED_POST.text,
      }),
    });
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[FAILED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    await openRowMenu(user, "post-failed");
    await user.click(
      screen.getByRole("menuitem", { name: "Duplicate as draft" }),
    );

    await waitFor(() => {
      expect(duplicateProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-failed",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Draft created.");
    expect(getTab("Drafts")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("social-post-post-failed-copy")).toBeVisible();
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
      within(dialog).queryByRole("button", { name: /^Post actions/ }),
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

  it("toasts when a link names a post that is gone", async () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
        requestedPostId="post-gone"
      />,
    );

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith("Couldn't open this post.", {
        duration: Infinity,
        closeButton: true,
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not toast when the named post is present", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost()]}
        projectId={PROJECT_ID}
        requestedPostId="post-draft"
        selectedPostId="post-draft"
      />,
    );

    expect(toastErrorMock).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeVisible();
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
    expect(screen.getByRole("button", { name: "Load more" })).toHaveClass(
      "h-11",
      "md:h-8",
    );
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

  it("shows an inline error and retries when loading more fails", async () => {
    const user = userEvent.setup();
    vi.mocked(loadMoreSocialPosts)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        posts: [buildPost({ id: "older", text: "Older draft" })],
        nextCursor: null,
      });
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
        posts={[buildPost()]}
        nextCursors={{ drafts: "drafts-cursor" }}
      />,
    );

    await openTab(user, "Drafts");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(
      await screen.findByTestId("social-load-more-error"),
    ).toHaveTextContent("Couldn't load more.");
    expect(toastErrorMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(screen.getByText("Older draft")).toBeVisible());
    expect(
      screen.queryByTestId("social-load-more-error"),
    ).not.toBeInTheDocument();
  });

  it.each([
    {
      name: "names an offline Load more",
      online: false,
      error: new Error("Failed to fetch"),
      copy: "You're offline.",
    },
    {
      name: "names a timed-out Load more",
      online: true,
      error: Object.assign(new Error("The operation timed out."), {
        name: "TimeoutError",
      }),
      copy: "Timed out.",
    },
  ])("$name", async ({ online, error, copy }) => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: online,
    });
    vi.mocked(loadMoreSocialPosts).mockRejectedValueOnce(error);
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
        posts={[buildPost()]}
        nextCursors={{ drafts: "drafts-cursor" }}
      />,
    );

    const user = userEvent.setup();
    await openTab(user, "Drafts");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(
      await screen.findByTestId("social-load-more-error"),
    ).toHaveTextContent(copy);
    expect(toastErrorMock).not.toHaveBeenCalled();
  });

  it("keeps Load more labeled and shows row skeletons while the next page loads", async () => {
    const user = userEvent.setup();
    let finish!: (value: {
      posts: SocialPost[];
      nextCursor: string | null;
    }) => void;
    vi.mocked(loadMoreSocialPosts).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
        posts={[buildPost()]}
        nextCursors={{ drafts: "drafts-cursor" }}
      />,
    );

    await openTab(user, "Drafts");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(screen.getByRole("button", { name: "Load more" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("social-post-row-skeleton")).toHaveLength(2);

    finish({
      posts: [buildPost({ id: "older", text: "Older draft" })],
      nextCursor: null,
    });
    await waitFor(() => expect(screen.getByText("Older draft")).toBeVisible());
    expect(
      screen.queryByTestId("social-post-row-skeleton"),
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
    const zone = formatTimezoneLabel(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      "en",
      NOW,
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
    const line = within(dialog).getByTestId("social-post-timezone");
    expect(line).toHaveTextContent(`Times are in your time zone, ${zone}.`);

    await pickInAnHour(user, dialog);
    expect(line).toHaveTextContent(
      `Goes out ${createTestFormatter().dateTime(IN_AN_HOUR, "dateTimeWithYear")} · ${formatTimezoneLabel(Intl.DateTimeFormat().resolvedOptions().timeZone, "en", IN_AN_HOUR)}`,
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

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Reschedule/,
      }),
    );
    expect(
      within(screen.getByRole("dialog")).getByTestId("social-post-timezone"),
    ).toHaveTextContent(
      `· ${formatTimezoneLabel(otherZone, "en", SCHEDULED_POST.scheduledAt ?? new Date())}`,
    );
  });

  it("uses the scheduled season for the composer's Goes out label", async () => {
    freezeClock(new Date("2026-01-15T12:00:00Z"));
    const resolved = new Intl.DateTimeFormat().resolvedOptions();
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      ...resolved,
      timeZone: "Europe/Prague",
    });
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          {
            ...SCHEDULED_POST,
            timezone: "Europe/Prague",
            scheduledAt: new Date("2026-10-05T12:00:00Z"),
          },
        ]}
        projectId={PROJECT_ID}
        selectedPostId="post-scheduled"
      />,
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^Reschedule/,
      }),
    );
    const label = within(screen.getByRole("dialog")).getByTestId(
      "social-post-timezone",
    );
    expect(label).toHaveTextContent(
      /Goes out .* · Central European Summer Time \(Prague\)$/,
    );
    expect(label).not.toHaveTextContent("Standard Time");
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

  it("toasts an offline message when saving a draft while disconnected", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const user = userEvent.setup();
    vi.mocked(createProjectSocialPost).mockRejectedValue(
      new Error("Failed to fetch"),
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
      expect(toastErrorMock).toHaveBeenCalledWith("You're offline. Try again."),
    );
  });

  it("toasts a timeout when canceling takes too long", async () => {
    const user = userEvent.setup();
    const timeout = new Error("The operation timed out");
    timeout.name = "TimeoutError";
    vi.mocked(cancelProjectSocialPost).mockRejectedValue(timeout);
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
      expect(toastErrorMock).toHaveBeenCalledWith("Timed out. Try again."),
    );
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

  it("names a rate-limited failure instead of the raw lastError", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[
          buildPost({
            ...FAILED_POST,
            lastError: "X rejected the post (429 too many requests)",
            lastAttempt: {
              ...FAILED_POST.lastAttempt!,
              errorKind: "rate_limited",
              outcome: "failed_transient",
            },
          }),
        ]}
        projectId={PROJECT_ID}
      />,
    );

    await openTab(user, "Needs attention");
    const row = screen.getByTestId("social-post-post-failed");
    expect(
      within(row).getByText("Rate limited. Try again later."),
    ).toBeVisible();
    expect(
      within(row).queryByText("X rejected the post (429 too many requests)"),
    ).not.toBeInTheDocument();
  });
});
