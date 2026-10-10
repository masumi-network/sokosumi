import type { SocialPost } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SocialPostPreviewDialog } from "./social-post-preview-dialog";

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    useFormatter: () => createTestFormatter(),
    useTranslations: () => (key: string, values?: { date?: string }) =>
      key === "failedAt" ? `Failed ${values?.date ?? ""}` : key,
  };
});

vi.mock("@/lib/actions/project/action", () => ({
  refreshProjectSocialPostStatistics: vi.fn(),
}));

vi.mock("./social-post-preview", () => ({
  SocialPostPreview: () => <div data-testid="social-post-preview" />,
}));

vi.mock("./social-post-metrics", () => ({
  SocialPostMetrics: () => <div data-testid="social-post-metrics" />,
}));

const POST: SocialPost = {
  id: "post-published",
  projectId: "project-1",
  provider: "x",
  text: "Hello",
  media: [],
  status: "PUBLISHED",
  scheduledAt: null,
  timezone: null,
  socialConnection: {
    id: "connection-1",
    externalHandle: "sokosumi",
    displayName: "Sokosumi",
    avatarUrl: null,
    status: "active",
  },
  creator: { kind: "user", id: "user-1", name: "Alice" },
  scheduledByUserId: null,
  canceledAt: null,
  publishedAt: new Date("2026-08-01T10:00:00.000Z"),
  publishedExternalId: "123",
  publishedUrl: "https://x.com/sokosumi/status/123",
  lastError: null,
  attemptCount: 1,
  nextAttemptAt: null,
  lastAttemptAt: null,
  lastAttempt: null,
  revision: 0,
  createdAt: new Date("2026-08-01T10:00:00.000Z"),
  updatedAt: new Date("2026-08-01T10:00:00.000Z"),
  canEdit: true,
  canSchedule: true,
  canCancel: false,
  canPublishNow: false,
  connectionNeedsReconnect: false,
};

describe("SocialPostPreviewDialog", () => {
  it("gives phone-sized targets to refresh and footer actions", () => {
    render(
      <SocialPostPreviewDialog
        open
        post={POST}
        onOpenChange={() => undefined}
        onCompose={() => undefined}
      />,
    );

    expect(
      screen.getByRole("button", { name: "statistics.refresh" }),
    ).toHaveClass("min-h-11");
    expect(screen.getByRole("link", { name: /viewPost/ })).toHaveClass(
      "min-h-11",
    );
    expect(screen.getByRole("button", { name: "composer.edit" })).toHaveClass(
      "min-h-11",
    );
    expect(
      screen.getByRole("button", { name: "composer.reschedule" }),
    ).toHaveClass("min-h-11");
  });

  it("shows why a failed post did not go out and when", () => {
    render(
      <SocialPostPreviewDialog
        open
        post={{
          ...POST,
          status: "FAILED",
          publishedUrl: null,
          lastError: "X rejected the post (403 forbidden)",
          lastAttempt: {
            attempt: 3,
            trigger: "scheduler",
            outcome: "failed_permanent",
            errorKind: "provider_rejected",
            providerOutcome: "403 forbidden",
            finishedAt: new Date("2026-09-10T10:05:00.000Z"),
          },
          canPublishNow: true,
        }}
        onOpenChange={() => undefined}
        onCompose={() => undefined}
      />,
    );

    const failure = screen.getByTestId("social-post-preview-failure");
    expect(failure).toHaveTextContent("X rejected the post (403 forbidden)");
    expect(failure).toHaveTextContent("Failed");
  });

  it("maps a revoked coworker schedule to the lean outcome copy", () => {
    render(
      <SocialPostPreviewDialog
        open
        post={{
          ...POST,
          status: "FAILED",
          publishedUrl: null,
          lastError: "Internal authorization failure text",
          lastAttempt: {
            attempt: 1,
            trigger: "publish_now",
            outcome: "authorization_revoked",
            errorKind: "authorization_revoked",
            providerOutcome: null,
            finishedAt: new Date("2026-09-10T10:05:00.000Z"),
          },
        }}
        onOpenChange={() => undefined}
        onCompose={() => undefined}
      />,
    );

    expect(screen.getByTestId("social-post-preview-failure")).toHaveTextContent(
      "outcomes.authorizationRevoked",
    );
    expect(
      screen.queryByText("Internal authorization failure text"),
    ).not.toBeInTheDocument();
  });

  it("shows the miss reason without a failure time", () => {
    render(
      <SocialPostPreviewDialog
        open
        post={{
          ...POST,
          status: "MISSED",
          publishedUrl: null,
          lastError: "Scheduled time passed more than an hour ago",
          lastAttempt: null,
        }}
        onOpenChange={() => undefined}
        onCompose={() => undefined}
      />,
    );

    expect(screen.getByTestId("social-post-preview-failure")).toHaveTextContent(
      "Scheduled time passed more than an hour ago",
    );
  });
});
