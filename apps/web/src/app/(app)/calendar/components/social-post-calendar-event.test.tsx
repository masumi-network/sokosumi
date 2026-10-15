import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFormats } from "@/i18n/time-format";
import messages from "../../../../../messages/en.json";
import { SocialPostCalendarEvent } from "./social-post-calendar-event";

const { openPreview } = vi.hoisted(() => ({
  openPreview: { current: null as null | ReturnType<typeof vi.fn> },
}));
vi.mock("@/app/social/components/social-calendar-preview", () => ({
  useSocialCalendarPreview: () => openPreview.current,
}));

const item: SocialPostCalendarItem = {
  kind: "socialPost",
  provider: "x",
  id: "social:post",
  postId: "post",
  sourceProjectId: "project",
  sourceWorkspaceId: "workspace",
  sourceId: "project:project",
  sourceType: "PROJECT",
  scheduledAt: new Date("2026-09-23T12:00:00Z"),
  lastAttempt: null,
  text: "Launch news",
  externalHandle: "team",
  status: "SCHEDULED",
  projectName: "Launch project",
  scheduledByName: "Albina",
  scheduledByImage: null,
  attachmentCount: 2,
  previewMedia: null,
};

function renderCard(
  overrides: Partial<SocialPostCalendarItem> = {},
  variant: "compact" | "preview" = "preview",
  showThumb = false,
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="UTC"
      messages={messages}
      formats={createFormats("h12")}
    >
      <SocialPostCalendarEvent
        timeZone="UTC"
        item={{ ...item, ...overrides }}
        variant={variant}
        showThumb={showThumb}
      />
    </NextIntlClientProvider>,
  );
}

describe("Social post calendar event", () => {
  beforeEach(() => {
    openPreview.current = null;
  });
  it("names the compact workspace card in one phrase", () => {
    renderCard({}, "compact");
    expect(
      screen.getByRole("button", { name: "12:00 PM, X post, Scheduled" }),
    ).toBeInTheDocument();
  });

  it("opens a Social post through the in-place preview instead of a project link", () => {
    openPreview.current = vi.fn();
    renderCard();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(openPreview.current).toHaveBeenCalledWith(
      "project",
      "post",
      screen.getByRole("button"),
    );
  });
  it.each([
    [
      {
        provider: "linkedin",
        previewMedia: { fileUrl: "v.mp4", kind: "video" },
        attachmentCount: 1,
      },
      "LinkedIn post with video",
    ],
    [
      {
        provider: "instagram",
        previewMedia: { fileUrl: "a.png", kind: "image" },
        attachmentCount: 3,
      },
      "Instagram post with 3 images",
    ],
    [{ provider: "x", previewMedia: null, attachmentCount: 0 }, "X post"],
  ] as const)(
    "sums a post up in one line on the workspace calendar",
    (overrides, label) => {
      renderCard(overrides, "compact");
      expect(
        screen.getByRole("button", { name: new RegExp(label) }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("calendar-social-post-thumb"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("social-post-provider-icon"),
      ).toBeInTheDocument();
    },
  );
  it("shows a square first image on a week chip and keeps the platform logo", () => {
    renderCard(
      { previewMedia: { fileUrl: "https://example.com/a.png", kind: "image" } },
      "compact",
      true,
    );
    const thumb = screen.getByTestId("calendar-social-post-thumb");
    const image = thumb.querySelector("img");
    expect(image).toHaveAttribute("src", "https://example.com/a.png");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveClass("object-cover");
    expect(thumb).toHaveClass(
      "size-7",
      "border-border",
      "bg-muted",
      "@max-[6.875rem]:hidden",
    );
    expect(screen.getByTestId("social-post-provider-icon")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /X post with 2 images/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("12:00 PM")).toBeInTheDocument();
    const chip = screen.getByTestId("calendar-social-post");
    const textCol = chip.firstElementChild;
    expect(textCol).toContainElement(
      screen.getByTestId("social-post-provider-icon"),
    );
    expect(textCol?.childElementCount).toBe(2);
    expect(chip.lastElementChild).toBe(thumb);
  });
  it("shows a video first-frame on a week chip and keeps the platform logo", () => {
    renderCard(
      {
        previewMedia: { fileUrl: "https://example.com/a.mp4", kind: "video" },
        attachmentCount: 1,
      },
      "compact",
      true,
    );
    expect(
      screen.getByTestId("calendar-social-post-thumb").querySelector("video"),
    ).toHaveAttribute("src", "https://example.com/a.mp4");
    expect(screen.getByTestId("social-post-provider-icon")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /X post with video/ }),
    ).toBeInTheDocument();
  });
  it("omits the thumbnail on a text-only week chip and keeps the name on its own line", () => {
    renderCard({ previewMedia: null, attachmentCount: 0 }, "compact", true);
    expect(
      screen.queryByTestId("calendar-social-post-thumb"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("social-post-provider-icon")).toBeInTheDocument();
    const name = screen.getByText("X post");
    expect(name).toBeVisible();
    expect(name).toHaveClass("truncate");
    const chip = screen.getByTestId("calendar-social-post");
    expect(chip.firstElementChild?.childElementCount).toBe(2);
    expect(chip.lastElementChild).not.toBe(
      screen.getByTestId("social-post-provider-icon"),
    );
  });
  it("marks a GIF on the week thumb without covering the frame", () => {
    renderCard(
      {
        previewMedia: { fileUrl: "https://example.com/a.gif", kind: "gif" },
        attachmentCount: 1,
      },
      "compact",
      true,
    );
    const thumb = screen.getByTestId("calendar-social-post-thumb");
    expect(thumb.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/a.gif",
    );
    expect(screen.getByTestId("social-post-preview-gif")).toHaveTextContent(
      "GIF",
    );
    expect(thumb.contains(screen.getByTestId("social-post-preview-gif"))).toBe(
      true,
    );
  });
  it("keeps a failed week chip as an icon so the word does not crowd the thumb", () => {
    renderCard(
      {
        status: "FAILED",
        previewMedia: { fileUrl: "https://example.com/a.png", kind: "image" },
      },
      "compact",
      true,
    );
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("social-post-status-reason"),
    ).toHaveAccessibleName("Failed");
    expect(
      screen.getByTestId("calendar-social-post-thumb"),
    ).toBeInTheDocument();
    expect(screen.getByText("12:00 PM")).toHaveClass("min-w-0", "truncate");
    expect(screen.getByText("12:00 PM")).not.toHaveClass("shrink-0");
    const weekChip = screen.getByTestId("calendar-social-post");
    expect(weekChip.firstElementChild).toHaveClass(
      "overflow-hidden",
      "min-w-0",
    );
    expect(weekChip.firstElementChild?.firstElementChild).toHaveClass(
      "min-w-0",
    );
  });
  it("keeps failed icon-only on a text-only week chip too", () => {
    renderCard(
      { status: "FAILED", previewMedia: null, attachmentCount: 0 },
      "compact",
      true,
    );
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("social-post-status-reason"),
    ).toHaveAccessibleName("Failed");
    expect(
      screen.queryByTestId("calendar-social-post-thumb"),
    ).not.toBeInTheDocument();
  });
  it("previews the first image attachment", () => {
    const { container } = renderCard({
      previewMedia: { fileUrl: "https://example.com/a.png", kind: "image" },
    });
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://example.com/a.png",
    );
  });
  it("previews a video attachment by its first frame", () => {
    const { container } = renderCard({
      previewMedia: { fileUrl: "https://example.com/a.mp4", kind: "video" },
    });
    expect(container.querySelector("video")).toHaveAttribute(
      "src",
      "https://example.com/a.mp4",
    );
  });
  it.each([
    ["SCHEDULED", "Scheduled"],
    ["PUBLISHED", "Published"],
  ] as const)(
    "uses an accessible icon instead of text for %s",
    (status, label) => {
      renderCard({ status });
      expect(screen.getByRole("img", { name: label })).toHaveAttribute(
        "title",
        label,
      );
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    },
  );
  it.each([
    ["FAILED", "Failed"],
    ["MISSED", "Missed"],
    ["CANCELED", "Canceled"],
    ["PUBLISHING", "Publishing"],
  ] as const)("names %s on the card", (status, label) => {
    renderCard({ status });
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.queryByRole("img", { name: label })).not.toBeInTheDocument();
  });
  it("names a failed post on the compact workspace chip too", () => {
    renderCard({ status: "FAILED" }, "compact");
    expect(screen.getByText("Failed")).toBeVisible();
    expect(screen.getByText("12:00 PM")).toHaveClass("shrink-0");
  });
  it("names a canceled post on the compact workspace chip too", () => {
    renderCard({ status: "CANCELED" }, "compact");
    expect(screen.getByText("Canceled")).toBeVisible();
  });
  it("names a publishing post on the compact workspace chip too", () => {
    renderCard({ status: "PUBLISHING" }, "compact");
    expect(screen.getByText("Publishing")).toBeVisible();
    expect(
      screen.queryByTestId("social-post-status-reason"),
    ).not.toBeInTheDocument();
  });
  it("describes a failed chip without showing the provider error", () => {
    renderCard({
      status: "FAILED",
      lastAttempt: { outcome: "failed_permanent", errorKind: "rejected" },
    });
    const chip = screen.getByTestId("social-post-status-reason");
    expect(chip).toHaveAccessibleName("Failed");
    expect(chip).toHaveAccessibleDescription(
      "The platform rejected this post.",
    );
    expect(
      screen.queryByText(/403|Duplicate|rejected the post/i),
    ).not.toBeInTheDocument();
  });
  it("opens the reason on tap without opening the post", () => {
    openPreview.current = vi.fn();
    renderCard({
      status: "FAILED",
      lastAttempt: {
        outcome: "connection_inactive",
        errorKind: null,
      },
    });
    fireEvent.click(screen.getByTestId("social-post-status-reason"));
    expect(openPreview.current).not.toHaveBeenCalled();
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Account disconnected. Reconnect to retry.",
    );
  });
  it("opens the missed reason on keyboard focus", () => {
    renderCard({
      status: "MISSED",
      lastAttempt: { outcome: "missed", errorKind: null },
    });
    fireEvent.focus(screen.getByTestId("social-post-status-reason"));
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "Missed the scheduled time.",
    );
  });
  it("falls back to generic copy when the kind is unknown", () => {
    renderCard({
      status: "FAILED",
      lastAttempt: { outcome: "failed_permanent", errorKind: "unknown" },
    });
    expect(
      screen.getByTestId("social-post-status-reason"),
    ).toHaveAccessibleDescription(
      "Couldn't publish. Open the post for details.",
    );
  });
  it("keeps a single @ on a YouTube handle that already has one", () => {
    renderCard({ provider: "youtube", externalHandle: "@alice" });
    expect(
      screen.getByRole("img", { name: "YouTube · @alice" }),
    ).toBeInTheDocument();
    expect(screen.getByText("@alice")).toBeVisible();
    expect(screen.queryByText("@@alice")).not.toBeInTheDocument();
  });
  it("opens the exact post and shows the X brand, project, scheduler, and attachments", () => {
    renderCard();
    expect(
      screen.getByRole("link", {
        name: "X · @team, 12:00 PM, Project: Launch project, Launch news, Scheduled, Scheduled by Albina, 2 attachments",
      }),
    ).toHaveAttribute(
      "href",
      "/social?projectId=project&postId=post#social-post-post",
    );
    expect(screen.getByRole("img", { name: "X · @team" })).toBeInTheDocument();
    // Which account it goes out on is visible, not only in the icon's label.
    expect(screen.getByText("@team")).toBeVisible();
    expect(screen.queryByText("Social post")).not.toBeInTheDocument();
    expect(screen.getByText("12:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Launch news")).toBeInTheDocument();
    expect(screen.getByTitle("Scheduled by Albina")).toBeInTheDocument();
    expect(screen.getByTitle("Project: Launch project")).toHaveTextContent(
      "Launch project",
    );
    expect(screen.getByText("Scheduled by Albina")).toBeInTheDocument();
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Scheduled" })).toHaveAttribute(
      "title",
      "Scheduled",
    );
    expect(screen.queryByText("Scheduled")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("handles a missing scheduler and media-only posts without displaying an empty attachment indicator", () => {
    renderCard({
      scheduledByName: null,
      attachmentCount: 0,
      text: "",
      externalHandle: null,
    });
    expect(screen.getByText("Scheduled by unknown user")).toBeInTheDocument();
    expect(screen.getByText("Media post")).toBeInTheDocument();
    expect(screen.queryByText(/attachments/)).not.toBeInTheDocument();
    expect(screen.queryByText("@team")).not.toBeInTheDocument();
    expect(screen.getByText("X")).toBeVisible();
  });
  it("encodes the ids it puts in the post link", () => {
    renderCard({ sourceProjectId: "a&b", postId: "c d" });
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/social?projectId=a%26b&postId=c+d#social-post-c%20d",
    );
  });

  it.each(["FAILED", "MISSED"] as const)(
    "opens a %s post on Needs attention",
    (status) => {
      renderCard({ status });
      expect(screen.getByRole("link")).toHaveAttribute(
        "href",
        "/social?projectId=project&postId=post&tab=attention#social-post-post",
      );
    },
  );
  it("lets the thumbnail stand for a single attachment", () => {
    renderCard({
      attachmentCount: 1,
      previewMedia: { fileUrl: "https://example.com/a.png", kind: "image" },
    });
    expect(screen.queryByText("1 attachment")).not.toBeInTheDocument();
  });
});
