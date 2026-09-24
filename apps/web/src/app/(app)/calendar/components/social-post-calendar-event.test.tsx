import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { createFormats } from "@/i18n/time-format";
import type { SocialPostCalendarItem } from "@/lib/clients/generated/core";
import messages from "../../../../../messages/en.json";
import { SocialPostCalendarEvent } from "./social-post-calendar-event";

const item: SocialPostCalendarItem = {
  kind: "socialPost",
  id: "social:post",
  postId: "post",
  sourceProjectId: "project",
  sourceWorkspaceId: "workspace",
  sourceId: "project:project",
  sourceType: "PROJECT",
  scheduledAt: new Date("2026-09-23T12:00:00Z"),
  text: "Launch news",
  externalHandle: "team",
  status: "SCHEDULED",
  projectName: "Launch project",
  scheduledByName: "Albina",
  scheduledByImage: null,
  attachmentCount: 2,
};

function renderCard(overrides: Partial<SocialPostCalendarItem> = {}) {
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
      />
    </NextIntlClientProvider>,
  );
}

describe("Social post calendar event", () => {
  it("opens the exact post and shows the X brand, project, scheduler, and attachments", () => {
    renderCard();
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/projects/project/social?postId=post#social-post-post",
    );
    expect(screen.getByRole("img", { name: "X · @team" })).toBeInTheDocument();
    expect(screen.queryByText("Social post")).not.toBeInTheDocument();
    expect(screen.getByText("12:00 PM")).toBeInTheDocument();
    expect(screen.getByText("Launch news")).toBeInTheDocument();
    expect(screen.getByTitle("Scheduled by Albina")).toBeInTheDocument();
    expect(screen.getByTitle("Project: Launch project")).toHaveTextContent(
      "Launch project",
    );
    expect(screen.getByText("Scheduled by Albina")).toBeInTheDocument();
    expect(screen.getByText("2 attachments")).toBeInTheDocument();
    expect(screen.getByText("Scheduled")).toBeInTheDocument();
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
  });
  it("labels a single attachment", () => {
    renderCard({ attachmentCount: 1 });
    expect(screen.getByText("1 attachment")).toBeInTheDocument();
  });
});
