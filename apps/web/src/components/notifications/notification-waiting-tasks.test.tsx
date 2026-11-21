import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SearchablePageContent } from "@/components/searchable-page-content";

const core = vi.hoisted(() => ({
  getTasksSummary: vi.fn(),
  getTasks: vi.fn(),
  getTaskEvents: vi.fn(),
}));
const createTaskComment = vi.hoisted(() => vi.fn());
vi.mock("@/lib/clients/core.browser.client", () => ({ coreClient: core }));
vi.mock("@/lib/actions/task/action", () => ({ createTaskComment }));
vi.mock("@/lib/auth/auth.client", () => ({
  useSession: () => ({
    data: { user: { id: "u1" }, session: { activeOrganizationId: null } },
  }),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key} ${JSON.stringify(values)}` : key,
}));
vi.mock("@/lib/utils/notification-time", () => ({
  useNotificationTimeFormatter: () => () => "now",
}));

import { NotificationWaitingTasks } from "./notification-waiting-tasks";

function task(
  id: string,
  status: string,
  statusSince = "2026-11-19T10:00:00.000Z",
) {
  return {
    id,
    name: `Task ${id}`,
    status,
    statusSince,
    updatedAt: "2026-11-19T10:00:00.000Z",
    assignee: { type: "sokoBot", sokoBot: { name: "Pip" } },
  };
}

function event(
  id: string,
  comment: string | null,
  extra: Record<string, unknown> = {},
) {
  return { id, comment, status: null, userId: null, ...extra };
}

const SINCE = "2026-11-19T10:00:00.000Z";

/** The event that put the Task in its listed wait. */
function parked(comment: string | null = null) {
  return event("park", comment, { status: "INPUT_REQUIRED", createdAt: SINCE });
}

function renderRows(tasks: ReturnType<typeof task>[], search = false) {
  core.getTasksSummary.mockResolvedValue({
    data: { awaitingInput: tasks.length },
  });
  core.getTasks.mockResolvedValue({ data: tasks });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      {search ? (
        <SearchablePageContent>
          <NotificationWaitingTasks />
        </SearchablePageContent>
      ) : (
        <NotificationWaitingTasks />
      )}
    </QueryClientProvider>,
  );
  return client;
}

async function openAnswer() {
  await userEvent.click(
    await screen.findByRole("button", { name: "action.INPUT_REQUIRED" }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("NotificationWaitingTasks", () => {
  it("finds a waiting Task on a later page by name without listing unrelated asks", async () => {
    const first = task("first", "INPUT_REQUIRED");
    const later = task("launch", "APPROVAL_REQUIRED");
    renderRows([first], true);
    await screen.findByRole("link", { name: /Task first/ });
    core.getTasks.mockImplementation(async ({ cursor }) =>
      cursor
        ? { data: [later] }
        : { data: [first], meta: { pagination: { nextCursor: "first" } } },
    );
    await userEvent.type(screen.getByRole("searchbox"), "launch");
    expect(
      await screen.findByRole("link", { name: /Task launch/ }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: /Task first/ })).toBeNull();
  });

  it("answers a Task waiting for input without leaving the list", async () => {
    core.getTaskEvents.mockResolvedValue({
      data: [parked("Which audience?")],
    });
    createTaskComment.mockResolvedValue(undefined);
    renderRows([task("t1", "INPUT_REQUIRED")]);

    await userEvent.click(
      await screen.findByRole("button", { name: "action.INPUT_REQUIRED" }),
    );
    expect(await screen.findByText("Which audience?")).toBeTruthy();
    expect(core.getTaskEvents).toHaveBeenCalledWith("t1");

    await userEvent.type(
      screen.getByRole("textbox"),
      "Small bakeries in Zurich",
    );
    await userEvent.click(screen.getByRole("button", { name: /^send/ }));

    expect(createTaskComment).toHaveBeenCalledWith({
      taskId: "t1",
      comment: "Small bakeries in Zurich",
    });
    expect(await screen.findByText(/^answerSent/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps other waiting Tasks as links to the Task", async () => {
    renderRows([task("t2", "APPROVAL_REQUIRED")]);

    expect(await screen.findByRole("link", { name: /Task t2/ })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "action.APPROVAL_REQUIRED" }),
    ).toBeNull();
  });

  it("posts one answer when Enter is pressed again while sending", async () => {
    core.getTaskEvents.mockResolvedValue({ data: [parked()] });
    const pending = Promise.withResolvers<undefined>();
    createTaskComment.mockReturnValue(pending.promise);
    renderRows([task("t1", "INPUT_REQUIRED")]);
    await openAnswer();

    const box = screen.getByRole("textbox");
    await userEvent.type(box, "Bakeries{Enter}");
    await userEvent.type(box, "{Enter}{Enter}");
    expect(createTaskComment).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(undefined));
  });

  it("returns focus to the Task link after the answer is sent", async () => {
    core.getTaskEvents.mockResolvedValue({ data: [parked()] });
    createTaskComment.mockResolvedValue(undefined);
    renderRows([task("t1", "INPUT_REQUIRED")]);
    await openAnswer();

    await userEvent.type(screen.getByRole("textbox"), "Bakeries{Enter}");

    await screen.findByText(/^answerSent/);
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /Task t1/ }),
    );
  });

  it("offers Answer again when the agent asks a second time", async () => {
    core.getTaskEvents.mockResolvedValue({ data: [parked()] });
    createTaskComment.mockResolvedValue(undefined);
    const client = renderRows([task("t1", "INPUT_REQUIRED")]);
    await openAnswer();
    await userEvent.type(screen.getByRole("textbox"), "Bakeries{Enter}");
    await screen.findByText(/^answerSent/);

    core.getTasks.mockResolvedValue({
      data: [task("t1", "INPUT_REQUIRED", "2026-11-19T11:00:00.000Z")],
    });
    await act(async () => client.invalidateQueries());

    expect(
      await screen.findByRole("button", { name: "action.INPUT_REQUIRED" }),
    ).toBeTruthy();
    expect(screen.queryByText(/^answerSent/)).toBeNull();
  });

  it("sends the reader to the Task when the question cannot be read", async () => {
    core.getTaskEvents.mockRejectedValue(new Error("down"));
    renderRows([task("t1", "INPUT_REQUIRED")]);
    await openAnswer();

    expect(await screen.findByText("questionError")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "questionOnTask" }).getAttribute("href"),
    ).toBe(screen.getByRole("link", { name: /Task t1/ }).getAttribute("href"));
  });

  it("points to the Task when this wait has no question of its own", async () => {
    core.getTaskEvents.mockResolvedValue({ data: [parked()] });
    renderRows([task("t1", "INPUT_REQUIRED")]);
    await openAnswer();

    expect(
      await screen.findByRole("link", { name: "questionOnTask" }),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("questionLoading")).toBeNull(),
    );
  });

  it("posts one answer when Answer is closed and reopened while sending", async () => {
    core.getTaskEvents.mockResolvedValue({ data: [parked()] });
    const pending = Promise.withResolvers<undefined>();
    createTaskComment.mockReturnValue(pending.promise);
    renderRows([task("t1", "INPUT_REQUIRED")]);
    await openAnswer();
    await userEvent.type(screen.getByRole("textbox"), "Bakeries{Enter}");

    const toggle = screen.getByRole("button", {
      name: "action.INPUT_REQUIRED",
    });
    await userEvent.click(toggle);
    await userEvent.click(toggle);
    await userEvent.type(screen.getByRole("textbox"), "Again{Enter}");
    expect(createTaskComment).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(undefined));
  });

  it("offers no Send once the Task has moved on, and reads the list again", async () => {
    core.getTaskEvents.mockResolvedValue({
      data: [
        parked("Which audience?"),
        event("e2", "Here is a draft", {
          status: "RUNNING",
          createdAt: "2026-11-19T10:05:00.000Z",
        }),
      ],
    });
    renderRows([task("t1", "INPUT_REQUIRED")]);
    await openAnswer();

    expect(await screen.findByText("waitEnded")).toBeTruthy();
    expect(screen.queryByText("Here is a draft")).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    await waitFor(() => expect(core.getTasks).toHaveBeenCalledTimes(2));
  });

  it("leaves focus alone when the reader moved on before the send finished", async () => {
    core.getTaskEvents.mockResolvedValue({ data: [parked()] });
    const pending = Promise.withResolvers<undefined>();
    createTaskComment.mockReturnValue(pending.promise);
    renderRows([task("t1", "INPUT_REQUIRED"), task("t2", "APPROVAL_REQUIRED")]);
    await openAnswer();
    await userEvent.type(screen.getByRole("textbox"), "Bakeries{Enter}");

    const other = screen.getByRole("link", { name: /Task t2/ });
    other.focus();
    await act(async () => pending.resolve(undefined));

    await screen.findByText(/^answerSent/);
    expect(document.activeElement).toBe(other);
  });
});
