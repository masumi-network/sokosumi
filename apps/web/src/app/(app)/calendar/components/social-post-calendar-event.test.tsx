import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SocialPostCalendarEvent } from "./social-post-calendar-event";

vi.mock("next-intl", async () => {
  const { createTestFormatter } = await import("@/test/intl-formatter");
  return {
    useFormatter: () => createTestFormatter({ locale: "en-US" }),
    useTranslations: () => (key: string) => key,
  };
});
describe("Social post calendar event", () => {
  it("opens the exact post and shows its account, content, and publishing state", () => {
    render(
      <SocialPostCalendarEvent
        timeZone="UTC"
        item={{
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
          status: "PUBLISHED",
        }}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/projects/project/social?postId=post#social-post-post",
    );
    expect(screen.getByText("Launch news")).toBeInTheDocument();
    expect(screen.getByText("@team")).toBeInTheDocument();
    expect(screen.getByText("PUBLISHED")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
