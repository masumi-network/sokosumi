import type { SocialPost, WorkspaceSocialPost } from "@sokosumi/core-client";
import { SOCIAL_PUBLIC_PROVIDERS } from "@sokosumi/utils";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "@/../messages/en.json";
import { SocialProviderAvailabilityProvider } from "@/contexts/social-provider-availability-context";

const { openPreview } = vi.hoisted(() => ({ openPreview: vi.fn() }));
vi.mock("./social-calendar-preview", () => ({
  useSocialCalendarPreview: () => openPreview,
}));

import { SocialAllProjectsAttention } from "./social-all-projects-attention";

function post(overrides: Partial<SocialPost>): SocialPost {
  return {
    id: "post-1",
    projectId: "project-1",
    provider: "x",
    text: "Sourdough Saturdays are back",
    status: "FAILED",
    scheduledAt: new Date("2026-11-11T09:00:00.000Z"),
    lastAttempt: null,
    lastAttemptAt: null,
    lastError: null,
    needsAttentionReason: null,
    canPublishNow: true,
    ...overrides,
  } as SocialPost;
}

function setup(items: WorkspaceSocialPost[], hasMore = false) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <SocialProviderAvailabilityProvider
        enabledProviders={SOCIAL_PUBLIC_PROVIDERS}
      >
        <SocialAllProjectsAttention hasMore={hasMore} items={items} />
      </SocialProviderAvailabilityProvider>
    </NextIntlClientProvider>,
  );
}

describe("SocialAllProjectsAttention", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists each project's failed and approval posts with the action that fixes them", async () => {
    const user = userEvent.setup();
    setup([
      {
        projectCmo: false,
        projectName: "Spring bakery launch",
        post: post({
          id: "failed",
          lastAttempt: {
            attempt: 1,
            trigger: "scheduler",
            outcome: "failed_transient",
            errorKind: "rate_limited",
            providerOutcome: null,
            finishedAt: new Date("2026-11-11T09:01:00.000Z"),
          },
        }),
      },
      {
        projectCmo: false,
        projectName: "Autumn menu",
        post: post({
          id: "approval",
          projectId: "project-2",
          status: "NEEDS_APPROVAL",
          canPublishNow: false,
        }),
      },
    ]);

    const failed = screen.getByTestId("social-all-attention-failed");
    expect(within(failed).getByText("Spring bakery launch")).toBeVisible();
    expect(within(failed).getByText("Failed")).toBeVisible();
    const retry = within(failed).getByRole("button", {
      name: "Retry: post in Spring bakery launch",
    });
    await user.click(retry);
    expect(openPreview).toHaveBeenCalledWith("project-1", "failed", retry);

    const approval = screen.getByTestId("social-all-attention-approval");
    expect(within(approval).getByText("Autumn menu")).toBeVisible();
    expect(within(approval).getByText("Waiting for approval")).toBeVisible();
    const review = within(approval).getByRole("button", {
      name: "Review: post in Autumn menu",
    });
    await user.click(review);
    expect(openPreview).toHaveBeenCalledWith("project-2", "approval", review);
  });

  it("offers Open, not Retry, on a post that cannot be retried", () => {
    setup([
      {
        projectCmo: false,
        projectName: "Spring bakery launch",
        post: post({ status: "MISSED", canPublishNow: false }),
      },
    ]);

    expect(
      screen.getByRole("button", {
        name: "Open: post in Spring bakery launch",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Retry/ })).toBeNull();
  });

  it("offers only Open on a CMO Project's posts", () => {
    setup([
      {
        projectCmo: true,
        projectName: "Managed by CMO",
        post: post({ id: "cmo-failed" }),
      },
      {
        projectCmo: true,
        projectName: "Managed by CMO",
        post: post({ id: "cmo-approval", status: "NEEDS_APPROVAL" }),
      },
    ]);

    expect(
      screen.getAllByRole("button", { name: "Open: post in Managed by CMO" }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: /^(Retry|Review)/ }),
    ).toBeNull();
  });

  it("says when nothing needs attention, and when the list is cut short", () => {
    const { unmount } = setup([]);
    expect(
      screen.getByText("Nothing needs attention in any project."),
    ).toBeVisible();
    unmount();

    setup(
      [
        {
          projectCmo: false,
          projectName: "Spring bakery launch",
          post: post({}),
        },
      ],
      true,
    );
    expect(
      screen.getByText(
        "Showing the latest 1. Choose a project to see all of its posts.",
      ),
    ).toBeVisible();
  });
});
