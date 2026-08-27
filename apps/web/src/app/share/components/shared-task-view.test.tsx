import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PublicSharedTask } from "@/lib/clients/generated/core";
import { SharedTaskView } from "./shared-task-view";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    dateTime: () => "Mar 30, 10:00 AM",
  }),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
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
  it("strips project context attachment links from the public description", async () => {
    render(await SharedTaskView({ task }));

    expect(screen.getByTestId("public-description")).toHaveTextContent(
      "User-visible brief",
    );
    expect(screen.queryByText(/CONTEXT.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/BRIEFING.md/)).not.toBeInTheDocument();
    expect(screen.queryByText(/DESIGN.md/)).not.toBeInTheDocument();
  });
});
