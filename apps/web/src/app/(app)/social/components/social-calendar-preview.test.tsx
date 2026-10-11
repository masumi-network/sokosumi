import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { load, onUrlUpdate, toastError } = vi.hoisted(() => ({
  load: vi.fn(),
  onUrlUpdate: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => toastError(...args) },
}));
vi.mock("./social-calendar-preview-actions", () => ({
  loadSocialCalendarPreview: load,
}));
vi.mock("@/app/projects/components/social-posts/project-social-posts", () => ({
  ProjectSocialPosts: ({
    projectId,
    selectedPostId,
    previewOnly,
  }: {
    projectId: string;
    selectedPostId: string;
    previewOnly: boolean;
  }) => (
    <div
      role="dialog"
      data-project={projectId}
      data-post={selectedPostId}
      data-preview-only={String(previewOnly)}
    />
  ),
}));

import {
  SocialCalendarPreviewProvider,
  useSocialCalendarPreview,
} from "./social-calendar-preview";

function CalendarPost() {
  const preview = useSocialCalendarPreview();
  return (
    <button
      type="button"
      onClick={(event) =>
        preview?.("post-project", "scheduled-post", event.currentTarget)
      }
    >
      Open post
    </button>
  );
}
describe("Social calendar previews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
  });
  it("opens the post's own project in a preview without changing calendar query state", async () => {
    load.mockResolvedValue({
      post: { id: "scheduled-post", projectId: "post-project" },
      connections: [],
    });
    render(
      <NuqsTestingAdapter
        searchParams="?view=week&date=2026-10-05&timezone=Europe%2FPrague&tab=calendar"
        onUrlUpdate={onUrlUpdate}
      >
        <SocialCalendarPreviewProvider>
          <CalendarPost />
        </SocialCalendarPreviewProvider>
      </NuqsTestingAdapter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open post" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "data-post",
        "scheduled-post",
      ),
    );
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-project",
      "post-project",
    );
    expect(screen.getByRole("dialog")).toHaveAttribute(
      "data-preview-only",
      "true",
    );
    expect(load).toHaveBeenCalledWith({
      projectId: "post-project",
      postId: "scheduled-post",
    });
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });
  it("restores calendar focus when loading is canceled", async () => {
    const user = userEvent.setup();
    load.mockImplementation(() => new Promise(() => {}));
    render(
      <NuqsTestingAdapter>
        <SocialCalendarPreviewProvider>
          <CalendarPost />
        </SocialCalendarPreviewProvider>
      </NuqsTestingAdapter>,
    );
    const trigger = screen.getByRole("button", { name: "Open post" });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByTestId("social-calendar-preview-skeleton"),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "names an offline load",
      online: false,
      error: new Error("Failed to fetch"),
      copy: "preview.offline",
    },
    {
      name: "names a timeout",
      online: true,
      error: Object.assign(new Error("The operation timed out."), {
        name: "TimeoutError",
      }),
      copy: "preview.timeout",
    },
    {
      name: "names a missing post",
      online: true,
      error: new Error("Social post not found"),
      copy: "preview.missing",
    },
    {
      name: "falls back to the generic load error",
      online: true,
      error: new Error("boom"),
      copy: "toasts.failed",
    },
  ])("$name", async ({ online, error, copy }) => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: online,
    });
    load.mockRejectedValue(error);
    render(
      <NuqsTestingAdapter>
        <SocialCalendarPreviewProvider>
          <CalendarPost />
        </SocialCalendarPreviewProvider>
      </NuqsTestingAdapter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy);
    expect(screen.getByRole("button", { name: "actions.retry" })).toBeVisible();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("retries an in-dialog preview load", async () => {
    const user = userEvent.setup();
    load.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({
      post: { id: "scheduled-post", projectId: "post-project" },
      connections: [],
    });
    render(
      <NuqsTestingAdapter>
        <SocialCalendarPreviewProvider>
          <CalendarPost />
        </SocialCalendarPreviewProvider>
      </NuqsTestingAdapter>,
    );
    await user.click(screen.getByRole("button", { name: "Open post" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("toasts.failed");
    await user.click(screen.getByRole("button", { name: "actions.retry" }));
    await waitFor(() =>
      expect(screen.getByRole("dialog")).toHaveAttribute(
        "data-post",
        "scheduled-post",
      ),
    );
    expect(load).toHaveBeenCalledTimes(2);
    expect(toastError).not.toHaveBeenCalled();
  });
});
