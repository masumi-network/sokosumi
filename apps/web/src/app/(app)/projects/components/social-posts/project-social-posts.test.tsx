import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectSocialPosts } from "@/app/projects/components/social-posts/project-social-posts";
import {
  cancelProjectSocialPost,
  createProjectSocialPost,
  publishProjectSocialPost,
  scheduleProjectSocialPost,
  updateProjectSocialPost,
} from "@/lib/actions/project/action";
import type {
  ProjectSocialConnection,
  SocialPost,
} from "@/lib/clients/generated/core/types.gen";

import { loadMoreSocialPosts } from "./actions";

vi.mock("./actions", () => ({ loadMoreSocialPosts: vi.fn() }));

const { pushMock, refreshMock, toastErrorMock, toastSuccessMock } = vi.hoisted(
  () => ({
    pushMock: vi.fn(),
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
    toastSuccessMock: vi.fn(),
  }),
);

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
  viewOnX: "View on X",
  publishedAt: "Published {date}",
  failedAt: "Failed {date}",
  attempts: "{count} attempts",
  "actions.publishNow": "Publish now",
  "actions.retry": "Retry",
  "sections.upcoming": "Upcoming",
  "sections.drafts": "Drafts",
  "sections.history": "History",
  "empty.upcoming": "No scheduled posts yet.",
  "empty.drafts": "No drafts yet.",
  "empty.history": "No published, failed, or canceled posts yet.",
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
  "composer.account": "Account",
  "composer.noAccount": "Choose an account",
  "composer.unknownHandle": "Unknown X account",
  "composer.scheduledAt": "Scheduled time",
  "composer.scheduledAtTooSoon": "Choose a time at least one minute from now.",
  "composer.saveDraft": "Save draft",
  "composer.save": "Save",
  "composer.schedule": "Schedule",
  "composer.reschedule": "Reschedule",
  "composer.cancel": "Cancel post",
  "composer.edit": "Edit",
  "composer.close": "Close",
  "cancelDialog.title": "Cancel this post?",
  "cancelDialog.description":
    "The post will not be published. You can schedule it again later.",
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
  "toasts.unauthenticated": "Please sign in to continue.",
  "toasts.unauthenticatedAction": "Sign in",
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
  scheduleProjectSocialPost: vi.fn(),
  updateProjectSocialPost: vi.fn(),
}));

const PROJECT_ID = "project-1";

function buildConnection(
  overrides: Partial<ProjectSocialConnection> = {},
): ProjectSocialConnection {
  return {
    id: "connection-1",
    provider: "x",
    externalHandle: "sokosumi",
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
    status: "active",
  },
  attemptCount: 1,
  lastAttemptAt: new Date("2026-09-15T09:00:00.000Z"),
  canEdit: false,
  canSchedule: false,
  canCancel: false,
  canPublishNow: false,
});

function dateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function futureDateTimeLocal(): string {
  return dateTimeLocal(new Date(Date.now() + 60 * 60 * 1000));
}

async function openRowMenu(
  user: ReturnType<typeof userEvent.setup>,
  postId: string,
) {
  const row = screen.getByTestId(`social-post-${postId}`);
  await user.click(within(row).getByRole("button", { name: "Post actions" }));
}

describe("ProjectSocialPosts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders Upcoming, Drafts, and History sections with their rows", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[buildPost(), SCHEDULED_POST, PUBLISHED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    const upcoming = screen.getByTestId("social-posts-section-upcoming");
    expect(
      within(upcoming).getByRole("heading", { name: "Upcoming" }),
    ).toBeVisible();
    const scheduledRow = within(upcoming).getByTestId(
      "social-post-post-scheduled",
    );
    expect(within(scheduledRow).getByText("Scheduled text")).toBeVisible();
    expect(within(scheduledRow).getByText("@sokosumi")).toBeVisible();
    expect(within(scheduledRow).getByText("Scheduled")).toBeVisible();
    expect(within(scheduledRow).getByText("Coworker · Scout")).toBeVisible();
    expect(within(scheduledRow).getByText("Oct 1, 10:00 AM")).toBeVisible();

    const drafts = screen.getByTestId("social-posts-section-drafts");
    const draftRow = within(drafts).getByTestId("social-post-post-draft");
    expect(within(draftRow).getByText("Draft text")).toBeVisible();
    expect(within(draftRow).getByText("No account")).toBeVisible();
    expect(within(draftRow).getByText("User · Alice")).toBeVisible();

    const history = screen.getByTestId("social-posts-section-history");
    const publishedRow = within(history).getByTestId(
      "social-post-post-published",
    );
    expect(within(publishedRow).getByText("Published")).toBeVisible();
    expect(within(publishedRow).getByText("Soko Bot")).toBeVisible();
    expect(
      within(publishedRow).queryByRole("button", { name: "Post actions" }),
    ).not.toBeInTheDocument();

    expect(screen.getAllByRole("list")).toHaveLength(3);
  });

  it("renders the complete post text without a line clamp", () => {
    render(
      <ProjectSocialPosts
        connections={[]}
        posts={[PUBLISHED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    expect(screen.getByText("Published text")).not.toHaveClass("line-clamp-2");
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
    await user.type(textarea, "x".repeat(281));
    expect(screen.getByTestId("social-post-character-count")).toHaveTextContent(
      "281 / 280",
    );
    expect(
      screen.getByTestId("social-post-character-count").className,
    ).toContain("text-destructive");
    expect(saveDraft).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Schedule" }),
    ).toBeDisabled();

    await user.type(textarea, "{backspace}");
    expect(screen.getByTestId("social-post-character-count")).toHaveTextContent(
      "280 / 280",
    );
    expect(saveDraft).toBeEnabled();
  });

  it("keeps Schedule disabled without an account or a future time", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts connections={[]} posts={[]} projectId={PROJECT_ID} />,
    );

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Text"), "Hello world");

    const schedule = within(dialog).getByRole("button", { name: "Schedule" });
    expect(
      within(dialog).getByRole("button", { name: "Save draft" }),
    ).toBeEnabled();
    expect(schedule).toBeDisabled();

    const timeInput = within(dialog).getByLabelText("Scheduled time");
    await user.type(timeInput, futureDateTimeLocal());
    expect(schedule).toBeDisabled();
  });

  it("requires the shared schedule lead time and rounds the input minimum up", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-24T10:00:15.000Z"));
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[]}
        projectId={PROJECT_ID}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "New post" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Text"), {
      target: { value: "Hello world" },
    });
    const timeInput = within(dialog).getByLabelText("Scheduled time");
    expect(timeInput).toHaveAttribute(
      "min",
      dateTimeLocal(new Date("2026-09-24T10:02:00.000Z")),
    );
    fireEvent.change(timeInput, {
      target: {
        value: dateTimeLocal(new Date("2026-09-24T10:01:00.000Z")),
      },
    });

    expect(timeInput).toHaveAttribute("aria-invalid", "true");
    expect(
      within(dialog).getByText("Choose a time at least one minute from now."),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Schedule" }),
    ).toBeDisabled();
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
        socialConnectionId: "connection-1",
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Draft saved.");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(
      within(screen.getByTestId("social-post-post-new")).getByText("Fresh"),
    ).toBeVisible();
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
        "Please sign in to continue.",
        expect.objectContaining({ action: expect.any(Object) }),
      ),
    );
    const toastOptions = toastErrorMock.mock.calls.at(-1)?.[1] as {
      action: { onClick: () => void };
    };
    toastOptions.action.onClick();
    expect(pushMock).toHaveBeenCalledWith("/signin");
  });

  it("schedules a new post with an ISO timestamp and the viewer timezone", async () => {
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
    const localValue = futureDateTimeLocal();
    await user.type(
      within(dialog).getByLabelText("Scheduled time"),
      localValue,
    );
    const schedule = within(dialog).getByRole("button", { name: "Schedule" });
    await waitFor(() => expect(schedule).toBeEnabled());
    await user.click(schedule);

    await waitFor(() => {
      expect(createProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        text: "Scheduled text",
        socialConnectionId: "connection-1",
        scheduledAt: new Date(localValue).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post scheduled.");
    expect(
      screen.getByTestId("social-posts-section-upcoming"),
    ).toHaveTextContent("Scheduled text");
  });

  it("shows the fallback error when scheduling rejects", async () => {
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
    await user.type(
      within(dialog).getByLabelText("Scheduled time"),
      futureDateTimeLocal(),
    );
    await user.click(within(dialog).getByRole("button", { name: "Schedule" }));

    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Something went wrong. Try again.",
      ),
    );
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
        socialConnectionId: "connection-1",
        revision: 4,
      });
    });
    expect(toastSuccessMock).toHaveBeenCalledWith("Post updated.");
    expect(
      within(screen.getByTestId("social-post-post-draft")).getByText("Edited"),
    ).toBeVisible();
  });

  it("reschedules a scheduled post from the row menu", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    await openRowMenu(user, "post-scheduled");
    await user.click(screen.getByRole("menuitem", { name: "Reschedule" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Reschedule post" }),
    ).toBeVisible();
    expect(within(dialog).queryByLabelText("Text")).not.toBeInTheDocument();
    const timeInput = within(dialog).getByLabelText("Scheduled time");
    await user.clear(timeInput);
    const localValue = futureDateTimeLocal();
    await user.type(timeInput, localValue);
    await user.click(
      within(dialog).getByRole("button", { name: "Reschedule" }),
    );

    await waitFor(() => {
      expect(scheduleProjectSocialPost).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        postId: "post-scheduled",
        scheduledAt: new Date(localValue).toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        socialConnectionId: "connection-1",
        revision: 2,
      });
    });
  });

  it("cancels a scheduled post only after confirmation", async () => {
    const user = userEvent.setup();
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
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
    expect(
      screen.getByTestId("social-posts-section-history"),
    ).toHaveTextContent("Scheduled text");
    expect(screen.getByText("No scheduled posts yet.")).toBeVisible();
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
              status: "reauthorization_required",
            },
            connectionNeedsReconnect: true,
          },
        ]}
        projectId={PROJECT_ID}
      />,
    );

    const row = screen.getByTestId("social-post-post-scheduled");
    const warning = within(row).getByTestId("social-post-needs-reconnect");
    expect(
      within(warning).getByText("Account needs reconnecting"),
    ).toBeVisible();
    expect(
      within(warning).getByRole("link", {
        name: "Reconnect the account",
      }),
    ).toHaveAttribute("href", "#social-accounts");
  });

  it("does not warn about reconnecting when the connection is active", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[SCHEDULED_POST]}
        projectId={PROJECT_ID}
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

    const history = screen.getByTestId("social-posts-section-history");
    const row = within(history).getByTestId("social-post-post-failed");
    expect(
      within(row).getByText("X rejected the post (403 forbidden)"),
    ).toBeVisible();
    expect(within(row).getByText("Failed Sep 10, 10:05 AM")).toBeVisible();
    expect(within(row).getByText("3 attempts")).toBeVisible();
    expect(within(row).getByText("Failed")).toBeVisible();

    await openRowMenu(user, "post-failed");
    expect(screen.getByRole("menuitem", { name: "Retry" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "Reschedule" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "Publish now" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("shows the missed reason on a MISSED row", () => {
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

    await openRowMenu(user, "post-failed");
    await user.click(screen.getByRole("menuitem", { name: "Retry" }));
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
    const row = screen.getByTestId("social-post-post-failed");
    expect(within(row).getByText("Published")).toBeVisible();
    expect(
      within(row).getByRole("link", { name: "View on X" }),
    ).toHaveAttribute("href", "https://x.com/sokosumi/status/42");
    expect(
      within(row).queryByText("X rejected the post (403 forbidden)"),
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
    const history = screen.getByTestId("social-posts-section-history");
    const row = within(history).getByTestId("social-post-post-draft");
    expect(within(row).getByText("X is unavailable")).toBeVisible();
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

  it("renders the external link and publish time on a PUBLISHED row", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHED_POST]}
        projectId={PROJECT_ID}
      />,
    );

    const row = screen.getByTestId("social-post-post-published");
    const link = within(row).getByRole("link", { name: "View on X" });
    expect(link).toHaveAttribute(
      "href",
      "https://x.com/sokosumi/status/1234567890",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(within(row).getByText("Published Aug 1, 10:00 AM")).toBeVisible();
    expect(
      within(row).queryByRole("button", { name: "Post actions" }),
    ).not.toBeInTheDocument();
  });

  it("lists a PUBLISHING post under Upcoming without actions", () => {
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHING_POST]}
        projectId={PROJECT_ID}
      />,
    );

    const upcoming = screen.getByTestId("social-posts-section-upcoming");
    const row = within(upcoming).getByTestId("social-post-post-publishing");
    expect(within(row).getByText("Publishing…")).toBeVisible();
    expect(
      within(row).queryByRole("button", { name: "Post actions" }),
    ).not.toBeInTheDocument();
  });

  it("orders History by publish, cancel, then update time, newest first", () => {
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
    render(
      <ProjectSocialPosts
        connections={[buildConnection()]}
        posts={[PUBLISHED_POST, canceled, failed]}
        projectId={PROJECT_ID}
      />,
    );

    const history = screen.getByTestId("social-posts-section-history");
    const rows = within(history).getAllByRole("listitem");
    expect(rows.map((row) => row.getAttribute("data-testid"))).toEqual([
      "social-post-post-failed",
      "social-post-post-canceled",
      "social-post-post-published",
    ]);
  });
  it("loads more history without replacing drafts or upcoming posts", async () => {
    const user = userEvent.setup();
    vi.mocked(loadMoreSocialPosts).mockResolvedValue({
      posts: [
        buildPost({ id: "older", status: "CANCELED", text: "Older history" }),
      ],
      nextCursor: null,
    });
    render(
      <ProjectSocialPosts
        projectId={PROJECT_ID}
        connections={[buildConnection()]}
        posts={[buildPost(), SCHEDULED_POST]}
        nextCursors={{ history: "history-cursor" }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(screen.getByText("Older history")).toBeVisible(),
    );
    expect(loadMoreSocialPosts).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      section: "history",
      cursor: "history-cursor",
    });
    expect(screen.getByTestId("social-post-post-draft")).toBeVisible();
    expect(
      screen.getByTestId(`social-post-${SCHEDULED_POST.id}`),
    ).toBeVisible();
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
});
