import type { SocialPost } from "@sokosumi/core-client";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SocialPostPreviewDialog } from "./social-post-preview-dialog";

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    useFormatter: () => createTestFormatter(),
    useTranslations: () => (key: string) => key,
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
});
