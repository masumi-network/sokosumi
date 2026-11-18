import {
  TaskStatus,
  type TaskTags,
  TaskVisibility,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { TaskWithCoworker } from "@/app/tasks/types/task-board";
import { setTaskWorkspaceTags } from "@/lib/actions/task/action";
import { loadTaskWorkspaceTags } from "@/lib/actions/task/load-workspace-tags";
import { workspaceTagsQueryKey } from "@/queries/workspace-tags";
import { TaskCard } from "./task-card";
import { TaskTagCatalogProvider } from "./task-tag-catalog";
import { TaskTags as CardTags, TaskTagSection } from "./task-tags";
import { useTaskFormWorkspaceTags } from "./use-task-form-workspace-tags";

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock("@/lib/actions/task/load-workspace-tags", () => ({
  loadTaskWorkspaceTags: vi.fn(),
}));
vi.mock("@/lib/actions/task/action", () => ({ setTaskWorkspaceTags: vi.fn() }));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
}));
vi.mock("@/lib/utils/datetime.client", () => ({
  useLocalizedDateTime: () => ({ formatShortDate: () => "Sep 26" }),
}));
vi.mock("./task-detail-link", () => ({
  TaskDetailLink: ({
    children,
    ...props
  }: {
    children: ReactNode;
    href: string;
    className?: string;
  }) => (
    <a
      {...props}
      onClick={(event) => {
        event.preventDefault();
        navigateMock();
      }}
    >
      {children}
    </a>
  ),
}));

const initialTags: TaskTags = {
  manual: ["design"],
  automatic: ["research"],
  rejected: [],
};

describe("TaskTagSection", () => {
  it("titles the section like the other sidebar headings, without a colon", () => {
    render(<TaskTagSection tags={initialTags} />);

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "appliedByJev",
    });
    expect(heading).toHaveClass(
      "text-muted-foreground",
      "text-xs",
      "font-medium",
    );
  });

  it("shows automatic and legacy manual tags with no edit affordance", () => {
    render(<TaskTagSection tags={initialTags} />);
    expect(screen.getByText("appliedByJev")).toBeInTheDocument();
    // Legacy manual choices still lead and are still labelled as the user's.
    expect(screen.getByText("vocabulary.design")).toHaveAttribute(
      "title",
      "manual",
    );
    expect(screen.getByText("vocabulary.research")).toHaveAttribute(
      "title",
      "automatic",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("restores a workspace tag after an edit fails and preserves Jev’s suggestions", async () => {
    vi.mocked(setTaskWorkspaceTags).mockResolvedValue({
      ok: false,
      error: { code: "forbidden" },
    });
    render(
      <TaskTagSection
        tags={initialTags}
        workspaceTags={[{ id: "release", displayName: "Release" }]}
        edit={{ taskId: "task-1", activeOrganizationId: null }}
      />,
    );
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "remove" }));
    await waitFor(() =>
      expect(screen.getByText("Release")).toBeInTheDocument(),
    );
    expect(setTaskWorkspaceTags).toHaveBeenCalledWith({
      taskId: "task-1",
      expectedWorkspaceTagIds: ["release"],
      workspaceTagIds: [],
    });
    expect(screen.getByTitle("automatic")).toHaveTextContent(
      "vocabulary.research",
    );
  });

  it("applies a pending workspace suggestion and shows later classifier updates on an open detail", async () => {
    const user = userEvent.setup();
    const edit = { taskId: "task", activeOrganizationId: null };
    const tag = {
      id: "label",
      displayName: "Procurement",
      color: "teal" as const,
    };
    const { rerender } = render(
      <TaskTagSection edit={edit} workspaceTags={[]} suggestions={[]} />,
    );
    rerender(
      <TaskTagSection edit={edit} workspaceTags={[]} suggestions={[tag]} />,
    );
    vi.mocked(setTaskWorkspaceTags).mockResolvedValue({
      ok: true,
      value: {
        workspaceTags: [{ ...tag, source: "manual" }],
        workspaceTagSuggestions: [],
      },
    });
    await user.click(screen.getByRole("button", { name: "acceptSuggestion" }));
    expect(setTaskWorkspaceTags).toHaveBeenCalledWith({
      taskId: "task",
      expectedWorkspaceTagIds: [],
      workspaceTagIds: ["label"],
    });
    expect(
      screen.queryByRole("button", { name: "acceptSuggestion" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Procurement").closest("[data-slot=badge]"),
    ).toHaveAttribute("data-tag-color", "teal");
    rerender(
      <TaskTagSection
        edit={edit}
        workspaceTags={[{ ...tag, source: "jev" }]}
        suggestions={[]}
      />,
    );
    expect(screen.getByText("appliedByJev")).toBeVisible();
    vi.mocked(setTaskWorkspaceTags).mockResolvedValue({
      ok: true,
      value: { workspaceTags: [], workspaceTagSuggestions: [] },
    });
    await user.click(screen.getByRole("button", { name: "remove" }));
    expect(setTaskWorkspaceTags).toHaveBeenLastCalledWith({
      taskId: "task",
      expectedWorkspaceTagIds: ["label"],
      workspaceTagIds: [],
      dismissedWorkspaceTagIds: ["label"],
    });
  });

  it("keeps a concurrent detail edit after refreshing and retrying a rejected replacement", async () => {
    const user = userEvent.setup();
    const tag = { id: "old", displayName: "Design", source: "jev" as const };
    const added = { id: "new", displayName: "Finance" };
    vi.mocked(setTaskWorkspaceTags)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "conflict", kind: "task_workspace_tags_changed" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: { workspaceTags: [added], workspaceTagSuggestions: [] },
      });
    vi.mocked(loadTaskWorkspaceTags).mockResolvedValue({
      workspaceTags: [tag, added],
      workspaceTagSuggestions: [],
    });
    render(
      <TaskTagSection
        workspaceTags={[tag]}
        edit={{ taskId: "task", activeOrganizationId: null }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "remove" }));
    expect(screen.getByRole("alert")).toHaveTextContent("conflict");
    expect(screen.getByText("Design")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "reloadTags" }));
    await user.click(
      within(screen.getByText("Design").parentElement!).getByRole("button", {
        name: "remove",
      }),
    );
    expect(setTaskWorkspaceTags).toHaveBeenLastCalledWith({
      taskId: "task",
      expectedWorkspaceTagIds: ["old", "new"],
      workspaceTagIds: ["new"],
      dismissedWorkspaceTagIds: ["old"],
    });
    expect(screen.getByText("Finance")).toBeVisible();
  });
  it("says so when a task has no tags yet", () => {
    render(<TaskTagSection />);
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("card tags", () => {
  it("leaves no empty line on a card without tags", () => {
    const { container } = render(<CardTags />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the tags a card has", () => {
    render(
      <CardTags tags={{ manual: [], automatic: ["writing"], rejected: [] }} />,
    );
    expect(screen.getByLabelText("label")).toHaveTextContent(
      "vocabulary.writing",
    );
  });
});

it("opens card tag overflow without following the task link", async () => {
  const task: TaskWithCoworker = {
    id: "task-1",
    name: "Review findings",
    status: TaskStatus.READY,
    identifier: null,
    priority: "NONE",
    visibility: TaskVisibility.PUBLIC,
    description: null,
    descriptionPlain: null,
    ownerId: "user-1",
    owner: { id: "user-1", name: "Owner", image: null },
    project: null,
    assignee: null,
    participants: [],
    commentsCount: 0,
    createdAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-26T00:00:00.000Z",
    jobsCount: 0,
    columnId: "todo",
    events: [],
    agents: [],
    tags: {
      manual: ["design"],
      automatic: ["research", "writing"],
      rejected: [],
    },
  };
  render(<TaskCard task={task} />);
  const user = userEvent.setup();
  const overflow = screen.getByRole("button", { name: "showAll" });
  expect(overflow.closest("a")).toBeNull();
  await user.click(overflow);
  const dialog = await screen.findByRole("dialog", { name: "label" });
  expect(within(dialog).getByText("vocabulary.writing")).toBeInTheDocument();
  expect(within(dialog).getByText("vocabulary.design")).toBeInTheDocument();
  expect(navigateMock).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("link", { name: task.name }));
  expect(navigateMock).toHaveBeenCalledTimes(1);
});

const baseLabel = {
  kind: "TAG" as const,
  description: null,
  vocabularyVersion: 1,
  archived: false,
};

function cachedCatalog(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <TaskTagCatalogProvider organizationId="org">
          {children}
        </TaskTagCatalogProvider>
      </QueryClientProvider>
    );
  };
}

it("uses the workspace color for a verified default topic and keeps a human homonym distinct", () => {
  const client = new QueryClient();
  const manual = {
    ...baseLabel,
    id: "custom",
    displayName: "Research",
    color: "red" as const,
  };
  client.setQueryData(workspaceTagsQueryKey("org"), [
    {
      ...baseLabel,
      id: "seed",
      displayName: "Design",
      taskTopicId: "design",
      color: "pink",
    },
    manual,
  ]);
  render(
    <TaskTagSection
      tags={{ automatic: ["design", "research"], manual: [], rejected: [] }}
      workspaceTags={[manual]}
    />,
    { wrapper: cachedCatalog(client) },
  );
  expect(screen.getByText("vocabulary.design")).toHaveAttribute(
    "data-tag-color",
    "pink",
  );
  expect(screen.getByText("Research")).toHaveAttribute("data-tag-color", "red");
  expect(screen.getByText("vocabulary.research")).not.toHaveAttribute(
    "data-tag-color",
    "red",
  );
});

it("drops a newly selected label from a draft when the catalog subsequently archives it", async () => {
  const client = new QueryClient();
  const label = { ...baseLabel, id: "vendors", displayName: "Vendors" };
  const queryKey = workspaceTagsQueryKey("org");
  client.setQueryData(queryKey, [label]);
  const { result } = renderHook(() => useTaskFormWorkspaceTags("org"), {
    wrapper: cachedCatalog(client),
  });
  act(() => result.current.setWorkspaceTags([label]));
  expect(result.current.workspaceTagIds).toEqual(["vendors"]);
  act(() => {
    client.setQueryData(queryKey, [{ ...label, archived: true }], {
      updatedAt: Date.now() + 1,
    });
  });
  await waitFor(() => expect(result.current.workspaceTags).toEqual([]));
  expect(result.current.workspaceTagIds).toBeUndefined();
});
