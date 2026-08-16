import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskProjectFilesAttachmentField } from "@/app/tasks/components/task-project-files-attachment";

vi.mock("next-intl", () => ({
  useFormatter: () => ({
    relativeTime: () => "2 hours ago",
  }),
  useNow: () => new Date("2026-08-16T10:00:00.000Z"),
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));

describe("TaskProjectFilesAttachmentField", () => {
  it("shows both project files checked by default selection", () => {
    render(
      <TaskProjectFilesAttachmentField
        selection={{ briefingEnabled: true, contextMdEnabled: true }}
        onSelectionChange={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", { name: /BRIEFING\.md/ }),
    ).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /CONTEXT\.md/ })).toBeChecked();
    expect(screen.getByText("briefingDescription")).toBeInTheDocument();
    expect(screen.getByText("contextDescription")).toBeInTheDocument();
  });

  it("shows the project memory update time with locale-safe relative formatting", () => {
    render(
      <TaskProjectFilesAttachmentField
        selection={{ briefingEnabled: true, contextMdEnabled: true }}
        onSelectionChange={vi.fn()}
        contextMdUpdatedAt={new Date("2026-08-16T08:00:00.000Z")}
      />,
    );

    expect(
      screen.getByText('contextDescriptionUpdated:{"when":"2 hours ago"}'),
    ).toBeInTheDocument();
  });

  it("reports each project-file checkbox independently", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();

    render(
      <TaskProjectFilesAttachmentField
        selection={{ briefingEnabled: true, contextMdEnabled: true }}
        onSelectionChange={onSelectionChange}
      />,
    );

    await user.click(screen.getByRole("checkbox", { name: /CONTEXT\.md/ }));

    expect(onSelectionChange).toHaveBeenCalledWith({
      briefingEnabled: true,
      contextMdEnabled: false,
    });
  });

  it("explains BRIEFING.md from the info hover", async () => {
    const user = userEvent.setup();

    render(
      <TaskProjectFilesAttachmentField
        selection={{ briefingEnabled: true, contextMdEnabled: true }}
        onSelectionChange={vi.fn()}
      />,
    );

    await user.hover(screen.getByRole("button", { name: "briefingInfoAria" }));

    expect(await screen.findByText("briefingInfo")).toBeInTheDocument();
  });
});
