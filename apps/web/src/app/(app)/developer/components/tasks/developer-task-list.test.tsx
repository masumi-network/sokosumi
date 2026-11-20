import { TaskStatus } from "@sokosumi/core-client";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { expect, it, vi } from "vitest";

import { PageListSearchContext } from "@/components/page-list-search";
import { listDeveloperTasksAction } from "@/lib/actions/developer-tasks/action";
import type { DeveloperTaskListRow } from "@/lib/services/developer-task.service";
import messages from "@/messages/en.json";
import { DeveloperTaskList } from "./developer-task-list";

vi.mock("@/lib/actions/developer-tasks/action", () => ({
  listDeveloperTasksAction: vi.fn(),
}));

it("searches older pages and ranks a task name before a visible status label", async () => {
  const task: DeveloperTaskListRow = {
    id: "first",
    name: "Publish the report",
    status: TaskStatus.QUEUED,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    assignee: null,
    creatorCoworker: null,
    owner: null,
    organization: null,
  };
  const byName = {
    ...task,
    id: "later",
    name: "Scheduled transfer",
    status: TaskStatus.DRAFT,
  };
  vi.mocked(listDeveloperTasksAction).mockResolvedValue({
    ok: true,
    value: { tasks: [byName], nextCursor: null, total: 2 },
  });

  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <PageListSearchContext.Provider
        value={{ query: "scheduled", register: () => () => {} }}
      >
        <DeveloperTaskList
          initialPage={{ tasks: [task], nextCursor: "first", total: 2 }}
        />
      </PageListSearchContext.Provider>
    </NextIntlClientProvider>,
  );

  expect(
    await screen.findByRole("link", { name: /Scheduled transfer/ }),
  ).toBeInTheDocument();
  const links = within(screen.getByRole("table")).getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual([
    "/developer/tasks/later",
    "/developer/tasks/first",
  ]);
  expect(listDeveloperTasksAction).toHaveBeenCalledExactlyOnceWith({
    cursor: "first",
  });
});
