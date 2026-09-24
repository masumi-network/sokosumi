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
  "sections.upcoming": "Upcoming",
  "sections.drafts": "Drafts",
  "sections.history": "History",
  "empty.upcoming": "No scheduled posts yet.",
  "empty.drafts": "No drafts yet.",
  "empty.history": "No published, failed, or canceled posts yet.",
  "status.DRAFT": "Draft",
  "status.SCHEDULED": "Scheduled",
  "status.PUBLISHING": "Publishing",
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
        if (key === "composer.characters" && values) {
          return `${values.count} / ${values.limit}`;
        }
        return MESSAGES[key] ?? key;
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
    revision: 0,
    createdAt: new Date("2026-09-01T10:00:00.000Z"),
    updatedAt: new Date("2026-09-01T10:00:00.000Z"),
    canEdit: true,
    canSchedule: true,
    canCancel: false,
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
  creator: { kind: "sokoBot", id: "bot-1", name: null },
  canEdit: false,
  canSchedule: false,
  canCancel: false,
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
