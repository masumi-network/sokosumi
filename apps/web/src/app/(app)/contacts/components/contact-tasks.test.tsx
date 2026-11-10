import type { TaskListItem } from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ContactTasks } from "./contact-tasks";

const { tasksMock, openNewTaskWizardMock } = vi.hoisted(() => ({
  tasksMock: vi.fn(),
  openNewTaskWizardMock: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values?.name ? `${key}:${values.name}` : key,
}));

vi.mock("@/lib/services/contacts.client", () => ({
  contactsService: { tasks: tasksMock },
}));

vi.mock("@/app/components/new-task-wizard-provider", () => ({
  useOptionalNewTaskWizard: () => ({
    openNewTaskWizard: openNewTaskWizardMock,
  }),
}));

vi.mock("@/app/tasks/components/task-due-badge", () => ({
  TaskDueBadge: () => null,
}));

const contact = { id: "contact-1", name: "Maya Stone" };

function task(id: string, name: string): TaskListItem {
  return {
    id,
    name,
    identifier: null,
    status: "DRAFT",
    dueOn: null,
  } as unknown as TaskListItem;
}

function renderTasks() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ContactTasks contact={contact} />
    </QueryClientProvider>,
  );
  return client;
}

describe("ContactTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists the contact's Tasks, linking each one", async () => {
    tasksMock.mockResolvedValue({
      items: [task("task-1", "Send Maya the deck")],
      nextCursor: null,
      total: 1,
    });
    renderTasks();

    const link = await screen.findByRole("link", {
      name: /Send Maya the deck/,
    });
    expect(link).toHaveAttribute("href", "/tasks/task-1");
    expect(tasksMock).toHaveBeenCalledWith("contact-1", undefined);
    expect(screen.queryByText("showMore")).not.toBeInTheDocument();
  });

  it("says when there are none yet", async () => {
    tasksMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    renderTasks();

    expect(await screen.findByText("empty:Maya Stone")).toBeInTheDocument();
  });

  it("loads the next page from Core", async () => {
    tasksMock
      .mockResolvedValueOnce({
        items: [task("task-1", "First")],
        nextCursor: "task-1",
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [task("task-2", "Second")],
        nextCursor: null,
        total: 2,
      });
    renderTasks();

    fireEvent.click(await screen.findByRole("button", { name: "showMore" }));

    expect(
      await screen.findByRole("link", { name: /Second/ }),
    ).toBeInTheDocument();
    expect(tasksMock).toHaveBeenLastCalledWith("contact-1", "task-1");
  });

  it("starts a new Task linked to the contact and refreshes the list", async () => {
    tasksMock.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    renderTasks();

    fireEvent.click(await screen.findByRole("button", { name: "new" }));

    expect(openNewTaskWizardMock).toHaveBeenCalledWith(
      expect.objectContaining({
        contactId: "contact-1",
        prompt: "prompt:Maya Stone",
      }),
    );
    openNewTaskWizardMock.mock.calls[0]?.[0].onTaskCreated("task-9");
    await waitFor(() => expect(tasksMock).toHaveBeenCalledTimes(2));
  });

  it("says so when the list cannot load", async () => {
    tasksMock.mockRejectedValue(new Error("core down"));
    renderTasks();

    expect(await screen.findByRole("status")).toHaveTextContent("error");
  });
});
