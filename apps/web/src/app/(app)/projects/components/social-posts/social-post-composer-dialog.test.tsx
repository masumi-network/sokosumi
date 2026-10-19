import type {
  ProjectSocialConnection,
  SocialPost,
} from "@sokosumi/core-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  approveProjectSocialPost,
  createProjectSocialPost,
  publishProjectSocialPost,
  scheduleProjectSocialPost,
  updateProjectSocialPost,
} from "@/lib/actions/project/action";
import { TestQueryProvider } from "@/test/query-provider";
import {
  SocialPostComposerDialog,
  type SocialPostComposerMode,
} from "./social-post-composer-dialog";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));

vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));

vi.mock("@/lib/actions/project/action", () => ({
  approveProjectSocialPost: vi.fn(),
  createProjectSocialPost: vi.fn(),
  publishProjectSocialPost: vi.fn(),
  scheduleProjectSocialPost: vi.fn(),
  updateProjectSocialPost: vi.fn(),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({ data: null }),
}));

vi.mock("@/lib/clients/core.browser.client", () => ({
  coreClient: {
    getProjectsByIdSocialConnections: vi.fn(),
    getProjectsByIdSocialConnectionsByConnectionIdSuggestedTimes: vi.fn(),
  },
}));

vi.mock("@/components/drive/drive-file-picker", () => ({
  DriveFilePicker: () => null,
}));

vi.mock("./social-post-preview", () => ({
  SocialPostPreview: () => null,
}));

vi.mock("@/lib/utils/drive-file-upload.client", () => ({
  uploadDriveFile: vi.fn(),
  isDriveFileUploadDuplicate: vi.fn(),
}));

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  const messages: Record<string, string> = {
    "approveDialog.scheduleAndApprove": "Schedule and approve",
    "composer.approvalHint": "Changing the time does not approve this post.",
    "composer.changeTime": "Change time",
    "composer.accountOption": "{provider} {handle}",
    "composer.text": "Text",
    "composer.schedulePicker.quick.inAnHour": "In an hour ({time})",
    "composer.scheduledAtTooSoon":
      "Choose a time at least one minute from now.",
    "composer.timezone.goesOut": "Goes out {date} ({zone})",
    "toasts.approved": "Post approved.",
    "toasts.approvalTimeChanged":
      "Time changed. The post still needs approval.",
  };
  return {
    useFormatter: () => createTestFormatter(),
    useLocale: () => "en",
    useTranslations: (namespace: string) => {
      const prefix = namespace.replace(/^App\.Projects\.SocialPosts\.?/, "");
      return (key: string, values?: Record<string, string | number>) => {
        const path = prefix ? `${prefix}.${key}` : key;
        const message = messages[path] ?? path;
        return Object.entries(values ?? {}).reduce(
          (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
          message,
        );
      };
    },
  };
});

const NOW = new Date("2026-09-15T12:00:00.000Z");
const NEXT_TIME = new Date("2026-09-15T13:00:00.000Z");
const connection: ProjectSocialConnection = {
  id: "connection-1",
  provider: "x",
  externalHandle: "sokosumi",
  displayName: null,
  avatarUrl: null,
  status: "active",
  connectedAt: NOW,
  disconnectedAt: null,
};

function pendingPost(): SocialPost {
  return {
    id: "post-1",
    projectId: "project-1",
    provider: "x",
    text: "A post by Lili",
    firstComment: null,
    media: [],
    status: "NEEDS_APPROVAL",
    scheduledAt: new Date("2026-09-15T11:00:00.000Z"),
    timezone: "UTC",
    socialConnection: connection,
    creator: { kind: "sokoBot", id: "bot-1", name: "Lili" },
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
    revision: 3,
    createdAt: NOW,
    updatedAt: NOW,
    canEdit: true,
    canSchedule: true,
    canCancel: false,
    canPublishNow: false,
    canApprove: true,
    canReject: true,
    canDuplicate: false,
    connectionNeedsReconnect: false,
  };
}

function renderComposer(mode: SocialPostComposerMode) {
  const callbacks = {
    onError: vi.fn(),
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
  };
  render(
    <SocialPostComposerDialog
      {...callbacks}
      connections={[connection]}
      mode={mode}
      open
      projectId="project-1"
    />,
    { wrapper: TestQueryProvider },
  );
  return callbacks;
}

describe("SocialPostComposerDialog approval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(["schedule", "edit"] as const)(
    "keeps approval pending when changing time in %s mode",
    async (kind) => {
      const user = userEvent.setup();
      const post = pendingPost();
      const updated = { ...post, scheduledAt: NEXT_TIME, revision: 4 };
      vi.mocked(scheduleProjectSocialPost).mockResolvedValue({
        ok: true,
        value: updated,
      });
      const callbacks = renderComposer({ kind, post });

      expect(
        screen.getByText("Changing the time does not approve this post."),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: /In an hour/ }));
      expect(screen.queryByText(/^Goes out/)).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Change time" }));

      await waitFor(() => {
        expect(scheduleProjectSocialPost).toHaveBeenCalledWith({
          projectId: "project-1",
          postId: "post-1",
          revision: 3,
          socialConnectionId: connection.id,
          scheduledAt: NEXT_TIME.toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        expect(toastSuccess).toHaveBeenCalledWith(
          "Time changed. The post still needs approval.",
        );
      });
      expect(callbacks.onSaved).toHaveBeenCalledWith(updated);
      expect(callbacks.onOpenChange).toHaveBeenCalledWith(false);
      expect(approveProjectSocialPost).not.toHaveBeenCalled();
      expect(publishProjectSocialPost).not.toHaveBeenCalled();
    },
  );

  it("picks a future time and approves in one request", async () => {
    const user = userEvent.setup();
    const post = pendingPost();
    const approved = {
      ...post,
      status: "SCHEDULED" as const,
      scheduledAt: NEXT_TIME,
      revision: 4,
    };
    vi.mocked(approveProjectSocialPost).mockResolvedValue({
      ok: true,
      value: approved,
    });
    const callbacks = renderComposer({ kind: "approve", post });

    const approve = screen.getByRole("button", {
      name: "Schedule and approve",
    });
    expect(approve).toBeDisabled();
    // The planned time has passed, so it is cleared rather than shown as an error.
    expect(
      screen.queryByText("Choose a time at least one minute from now."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Text" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "X @sokosumi" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /In an hour/ }));
    expect(approve).toBeEnabled();
    await user.click(approve);

    await waitFor(() => {
      expect(approveProjectSocialPost).toHaveBeenCalledExactlyOnceWith({
        projectId: "project-1",
        postId: "post-1",
        revision: 3,
        scheduledAt: NEXT_TIME.toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      expect(toastSuccess).toHaveBeenCalledWith("Post approved.");
    });
    expect(callbacks.onSaved).toHaveBeenCalledWith(approved);
    expect(callbacks.onOpenChange).toHaveBeenCalledWith(false);
    expect(scheduleProjectSocialPost).not.toHaveBeenCalled();
    expect(updateProjectSocialPost).not.toHaveBeenCalled();
    expect(createProjectSocialPost).not.toHaveBeenCalled();
    expect(publishProjectSocialPost).not.toHaveBeenCalled();
  });

  it("keeps the dialog open when approval fails", async () => {
    const user = userEvent.setup();
    const error = { code: "BAD_INPUT", message: "Reconnect the account." };
    vi.mocked(approveProjectSocialPost).mockResolvedValue({ ok: false, error });
    const callbacks = renderComposer({ kind: "approve", post: pendingPost() });

    await user.click(screen.getByRole("button", { name: /In an hour/ }));
    await user.click(
      screen.getByRole("button", { name: "Schedule and approve" }),
    );

    await waitFor(() => expect(callbacks.onError).toHaveBeenCalledWith(error));
    expect(callbacks.onSaved).not.toHaveBeenCalled();
    expect(callbacks.onOpenChange).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(scheduleProjectSocialPost).not.toHaveBeenCalled();
  });
});
