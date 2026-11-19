import {
  TaskStatus,
  type TaskTags,
  TaskVisibility,
} from "@sokosumi/core-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
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
const emptyTags: TaskTags = { manual: [], automatic: [], rejected: [] };

function removeButton(label: string) {
  const badge = screen
    .getByText(label)
    .closest<HTMLElement>("[data-slot=badge]");
  expect(badge).not.toBeNull();
  return within(badge!).getByRole("button", { name: "remove" });
}

describe("TaskTagSection", () => {
  it("groups saved workspace and topic tags under one heading, without exposing their source", () => {
    render(
      <TaskTagSection
        tags={initialTags}
        workspaceTags={[
          { id: "workspace-manual", displayName: "Planning", source: "manual" },
          {
            id: "workspace-auto",
            displayName: "Launch",
            source: "jev",
            color: "teal",
          },
        ]}
      />,
    );
    const heading = screen.getByRole("heading", { level: 2, name: "label" });
    expect(screen.getAllByRole("heading")).toEqual([heading]);
    expect(heading).toHaveClass(
      "text-muted-foreground",
      "text-xs",
      "font-medium",
    );
    // Legacy manual choices still lead the automatically classified topics.
    const badges = Array.from(
      screen
        .getByRole("region", { name: "label" })
        .querySelectorAll("[data-slot=badge]"),
    );
    expect(badges.map((badge) => badge.textContent)).toEqual([
      "Planning",
      "Launch",
      "vocabulary.design",
      "vocabulary.research",
    ]);
    expect(badges[1]).toHaveAttribute("data-tag-color", "teal");
    for (const badge of badges) {
      expect(badge.className).toBe(badges[0]!.className);
      expect(badge).not.toHaveAttribute("title");
      expect(badge.querySelector("svg")).toBeNull();
    }
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("shows a color dot on Finance, Operations, and Data and analytics without fetching a catalog", () => {
    render(
      <TaskTagSection
        tags={{
          manual: [],
          automatic: ["finance", "operations"],
          rejected: [],
        }}
        workspaceTags={[
          {
            id: "operations-tag",
            displayName: "Operations",
            taskTopicId: "operations",
          },
          {
            id: "analytics",
            displayName: "Data and analytics",
            color: "teal",
            customColor: "#2F7189",
          },
        ]}
      />,
    );
    for (const label of [
      "vocabulary.finance",
      "Operations",
      "Data and analytics",
    ]) {
      const badge = screen
        .getByText(label)
        .closest<HTMLElement>("[data-slot=badge]")!;
      const dot = badge.querySelector("[aria-hidden=true][data-tag-color]");
      expect(dot).toBeVisible();
      expect(dot).toHaveAttribute("data-tag-color", badge.dataset.tagColor);
      if (label === "Data and analytics")
        expect(dot).toHaveAttribute("data-tag-color", "#2F7189");
    }
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
    await act(async () => fireEvent.click(removeButton("Release")));
    expect(screen.getByText("Release")).toBeInTheDocument();
    expect(setTaskWorkspaceTags).toHaveBeenCalledWith({
      taskId: "task-1",
      expectedWorkspaceTagIds: ["release"],
      workspaceTagIds: [],
    });
    const topic = screen
      .getByText("vocabulary.research")
      .closest("[data-slot=badge]");
    const workspaceTag = screen
      .getByText("Release")
      .closest("[data-slot=badge]");
    expect(topic?.parentElement).toBe(workspaceTag?.parentElement);
    expect(topic).not.toHaveAttribute("title");
    expect(removeButton("vocabulary.research")).toBeEnabled();
  });

  it("removes a saved topic immediately and restores it when the save fails", async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof setTaskWorkspaceTags>>>();
    vi.mocked(setTaskWorkspaceTags).mockReturnValueOnce(pending.promise);
    render(
      <TaskTagSection
        tags={initialTags}
        edit={{ taskId: "task-1", activeOrganizationId: null }}
      />,
    );
    await userEvent.setup().click(removeButton("vocabulary.research"));
    expect(setTaskWorkspaceTags).toHaveBeenCalledWith({
      taskId: "task-1",
      dismissedTopicIds: ["research"],
    });
    expect(screen.queryByText("vocabulary.research")).not.toBeInTheDocument();
    expect(screen.getByText("vocabulary.design")).toBeVisible();
    await act(async () =>
      pending.resolve({ ok: false, error: { code: "forbidden" } }),
    );
    expect(removeButton("vocabulary.research")).toBeEnabled();
  });

  it("applies a pending workspace suggestion and shows later classifier updates on an open detail", async () => {
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
        tags: emptyTags,
        workspaceTags: [{ ...tag, source: "manual" }],
        workspaceTagSuggestions: [],
      },
    });
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "acceptSuggestion" })),
    );
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
    expect(screen.queryByText("appliedByJev")).not.toBeInTheDocument();
    expect(screen.queryByTitle("appliedByJev")).not.toBeInTheDocument();
    vi.mocked(setTaskWorkspaceTags).mockResolvedValue({
      ok: true,
      value: {
        tags: emptyTags,
        workspaceTags: [],
        workspaceTagSuggestions: [],
      },
    });
    await act(async () => fireEvent.click(removeButton("Procurement")));
    expect(setTaskWorkspaceTags).toHaveBeenLastCalledWith({
      taskId: "task",
      expectedWorkspaceTagIds: ["label"],
      workspaceTagIds: [],
      dismissedWorkspaceTagIds: ["label"],
    });
  });

  it("removes a legacy manual topic and shows the server's confirmed tags", async () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof setTaskWorkspaceTags>>>();
    render(
      <TaskTagSection
        tags={initialTags}
        edit={{ taskId: "task", activeOrganizationId: null }}
      />,
    );
    vi.mocked(setTaskWorkspaceTags).mockReturnValueOnce(pending.promise);
    try {
      await userEvent.setup().click(removeButton("vocabulary.design"));
      expect(setTaskWorkspaceTags).toHaveBeenCalledWith({
        taskId: "task",
        dismissedTopicIds: ["design"],
      });
      expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
      expect(screen.queryByText("vocabulary.writing")).not.toBeInTheDocument();
    } finally {
      await act(async () =>
        pending.resolve({
          ok: true,
          value: {
            tags: {
              manual: [],
              automatic: ["research", "writing"],
              rejected: ["design"],
            },
            workspaceTags: [],
            workspaceTagSuggestions: [],
          },
        }),
      );
    }
    expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
    expect(removeButton("vocabulary.writing")).toBeEnabled();
  });

  it("keeps a concurrent detail edit after refreshing and retrying a rejected replacement", async () => {
    const tag = { id: "old", displayName: "Design", source: "jev" as const };
    const added = { id: "new", displayName: "Finance" };
    vi.mocked(setTaskWorkspaceTags)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "conflict", kind: "task_workspace_tags_changed" },
      })
      .mockResolvedValueOnce({
        ok: true,
        value: {
          tags: initialTags,
          workspaceTags: [added],
          workspaceTagSuggestions: [],
        },
      });
    vi.mocked(loadTaskWorkspaceTags).mockResolvedValue({
      tags: initialTags,
      workspaceTags: [tag, added],
      workspaceTagSuggestions: [],
    });
    render(
      <TaskTagSection
        workspaceTags={[tag]}
        edit={{ taskId: "task", activeOrganizationId: null }}
      />,
    );
    await act(async () => fireEvent.click(removeButton("Design")));
    expect(screen.getByRole("alert")).toHaveTextContent("conflict");
    expect(screen.getByText("Design")).toBeVisible();
    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "reloadTags" })),
    );
    expect(removeButton("vocabulary.research")).toBeEnabled();
    await act(async () => fireEvent.click(removeButton("Design")));
    expect(setTaskWorkspaceTags).toHaveBeenLastCalledWith({
      taskId: "task",
      expectedWorkspaceTagIds: ["old", "new"],
      workspaceTagIds: ["new"],
      dismissedWorkspaceTagIds: ["old"],
    });
    expect(screen.getByText("Finance")).toBeVisible();
    expect(screen.getByText("vocabulary.research")).toBeVisible();
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
  expect(within(dialog).queryByText("appliedByJev")).not.toBeInTheDocument();
  expect(within(dialog).queryByTitle("automatic")).not.toBeInTheDocument();
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

it("removes a canonical topic and its workspace alias with a single click", async () => {
  const client = new QueryClient();
  const label = {
    ...baseLabel,
    id: "seed-design",
    displayName: "Design",
    taskTopicId: "design" as const,
    color: "teal" as const,
  };
  client.setQueryData(workspaceTagsQueryKey("org"), [label]);
  const view = render(
    <TaskTagSection
      tags={{ manual: [], automatic: ["design"], rejected: [] }}
      workspaceTags={[{ ...label, source: "jev" }]}
      edit={{ taskId: "task", activeOrganizationId: "org" }}
    />,
    { wrapper: cachedCatalog(client) },
  );
  expect(screen.getByText("Design")).toBeVisible();
  expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
  vi.mocked(setTaskWorkspaceTags).mockResolvedValue({
    ok: true,
    value: {
      tags: { automatic: [], manual: [], rejected: ["design"] },
      workspaceTags: [],
      workspaceTagSuggestions: [],
    },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "remove" })),
  );
  expect(setTaskWorkspaceTags).toHaveBeenCalledTimes(1);
  expect(setTaskWorkspaceTags).toHaveBeenCalledWith({
    taskId: "task",
    workspaceTagIds: [],
    expectedWorkspaceTagIds: [label.id],
    dismissedWorkspaceTagIds: [label.id],
    dismissedTopicIds: ["design"],
  });
  expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
  expect(screen.queryByText("Design")).not.toBeInTheDocument();
  view.rerender(
    <CardTags
      tags={{ manual: [], automatic: ["design", "research"], rejected: [] }}
      workspaceTags={[label]}
      compact
      inLink
    />,
  );
  expect(screen.getByText("+1")).toHaveAttribute(
    "title",
    "vocabulary.research",
  );
});

it("shows a confirmed alias once on a read-only detail without workspace catalog access", () => {
  render(
    <TaskTagSection
      tags={{ manual: [], automatic: ["design", "research"], rejected: [] }}
      workspaceTags={[
        {
          id: "seed",
          displayName: "Design",
          color: "teal",
          taskTopicId: "design",
        },
        { id: "custom-research", displayName: "Research" },
      ]}
    />,
  );
  expect(screen.getByText("Design")).toBeVisible();
  expect(screen.queryByText("vocabulary.design")).not.toBeInTheDocument();
  expect(screen.getByText("Research")).toBeVisible();
  expect(screen.getByText("vocabulary.research")).toBeVisible();
});

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
      customColor: "#D32A91",
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
  expect(
    screen.getByText("vocabulary.design").closest("[data-slot=badge]"),
  ).toHaveAttribute("data-tag-color", "#D32A91");
  expect(
    screen.getByText("Research").closest("[data-slot=badge]"),
  ).toHaveAttribute("data-tag-color", "red");
  expect(
    screen.getByText("vocabulary.research").closest("[data-slot=badge]"),
  ).not.toHaveAttribute("data-tag-color", "red");
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
