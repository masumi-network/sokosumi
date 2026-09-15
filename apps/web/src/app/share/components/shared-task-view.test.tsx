import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicSharedTask } from "@/lib/clients/generated/core";
import { createTestFormatter } from "@/test/intl-formatter";
import { SharedTaskView } from "./shared-task-view";

const getFormatterMock = vi.hoisted(() => vi.fn());

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
  getFormatter: () => getFormatterMock(),
  getTranslations: vi.fn(async () => (key: string) => key),
}));

vi.mock("@/app/tasks/components/task-files", () => ({
  TaskFiles: () => null,
}));

vi.mock("@/components/sources/sources-grid", () => ({
  SourcesGrid: () => null,
}));

vi.mock("@/components/expandable-markdown", () => ({
  ExpandableMarkdown: ({ content }: { content: string }) => (
    <div data-testid="public-description">{content}</div>
  ),
}));

const task = {
  id: "task_123",
  createdAt: new Date("2026-03-30T10:00:00.000Z"),
  updatedAt: new Date("2026-03-30T11:00:00.000Z"),
  name: "Shared Task",
  description:
    "[DESIGN.md](https://blob.example/DESIGN.md)\n[BRIEFING.md](https://blob.example/BRIEFING.md)\n[CONTEXT.md](https://blob.example/CONTEXT.md)\n\nUser-visible brief",
  status: "READY",
  assignee: {
    id: "cow_1",
    name: "Ops Agent",
    slug: "ops-agent",
    image: null,
  },
  jobs: [],
  events: [],
  files: [],
} as unknown as PublicSharedTask;

describe("SharedTaskView", () => {
  beforeEach(() => {
    getFormatterMock.mockResolvedValue(createTestFormatter());
  });

  it("strips project context attachment links from the public description", async () => {
    render(await SharedTaskView({ task }));

    expect(screen.getByTestId("public-description")).toHaveTextContent(
      "User-visible brief",
    );
    expect(screen.queryByText(/CONTEXT.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BRIEFING.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DESIGN.md/)).not.toBeInTheDocument();
  });

  it("applies md:pt-4 on the metadata aside", async () => {
    const { container } = render(await SharedTaskView({ task }));
    const aside = container.querySelector("aside");

    expect(aside).not.toBeNull();
    expect(aside?.className.split(/\s+/)).toContain("md:pt-4");
  });

  it("writes the created time in the viewer's hour cycle", async () => {
    // 14:50 UTC is 16:50 in Berlin during CEST.
    const sharedTask = {
      ...task,
      createdAt: new Date("2026-09-15T14:50:00.000Z"),
    };

    getFormatterMock.mockResolvedValue(
      createTestFormatter({ timeZone: "Europe/Berlin", hourCycle: "h23" }),
    );
    const { unmount } = render(await SharedTaskView({ task: sharedTask }));
    expect(screen.getByText("Sep 15, 2026, 16:50")).toBeInTheDocument();
    unmount();

    getFormatterMock.mockResolvedValue(
      createTestFormatter({ timeZone: "Europe/Berlin", hourCycle: "h12" }),
    );
    render(await SharedTaskView({ task: sharedTask }));
    expect(screen.getByText("Sep 15, 2026, 4:50 PM")).toBeInTheDocument();
  });
});
