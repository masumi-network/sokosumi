import {
  type CallToolResult,
  InMemoryTransport,
} from "@modelcontextprotocol/client";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK } from "../../../harness/fixtures.ts";
import { Shell } from "../../shell/Shell.tsx";
import { TaskDetail, TaskResult } from "./TaskDetail.tsx";

type Answer = (name: string) => Promise<CallToolResult>;

const answers: Answer = async () => TASK.result;

/** A fake host and what the view sent it. `serverTools: false` offers no tool calls. */
async function openTask(
  result: CallToolResult,
  {
    answer = answers,
    serverTools = true,
    input = TASK.input,
  }: {
    answer?: Answer;
    serverTools?: boolean;
    input?: Record<string, unknown>;
  } = {},
) {
  const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    { openLinks: {}, ...(serverTools && { serverTools: {} }) },
    { hostContext: { locale: "en-US", timeZone: "UTC" } },
  );
  const sent = { links: vi.fn(), calls: vi.fn() };
  bridge.onopenlink = async ({ url }) => {
    sent.links(url);
    return {};
  };
  bridge.oncalltool = async ({ name, arguments: args }) => {
    sent.calls(name, args);
    return answer(name);
  };
  const initialized = new Promise<void>((resolve) => {
    bridge.oninitialized = () => resolve();
  });
  await bridge.connect(hostSide);

  const app = new App(
    { name: "test-view", version: "1.0.0" },
    {},
    { autoResize: false },
  );
  render(
    <Shell
      app={app}
      transport={viewSide}
      schema={TaskResult}
      refreshTool="tasks_get"
    >
      {(data, context) => <TaskDetail data={data} context={context} />}
    </Shell>,
  );
  await act(() => initialized);
  await act(() => bridge.sendToolInput({ arguments: input }));
  await act(() => bridge.sendToolResult(result));
  return sent;
}

const timelineButton = () => screen.getByRole("button", { name: /^Timeline/ });
const openTimeline = () => act(async () => fireEvent.click(timelineButton()));
const timelineItems = () =>
  within(screen.getByRole("list", { name: "Timeline" }))
    .getAllByRole("listitem")
    .map((item) => item.textContent);

afterEach(cleanup);

describe("TaskDetail header", () => {
  it("shows the name, identifier, status, assignee, due date and workspace", async () => {
    await openTask(TASK.result);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Research competitor pricing in the DACH market",
      }),
    ).toBeTruthy();
    expect(screen.getByText("ACME-39 · Ready")).toBeTruthy();
    expect(screen.getByText("Due Nov 28, 2026 · Acme Studio")).toBeTruthy();
    expect(screen.getByText("MA")).toBeTruthy();
    expect(screen.getByText("Assigned to Market Analyst")).toBeTruthy();
  });

  it("leaves out what a bare Task does not have", async () => {
    await openTask(TASK.bare);

    expect(screen.getByText("No description")).toBeTruthy();
    expect(screen.queryByText(/^Due/)).toBeNull();
    expect(screen.queryByText("Acme Studio")).toBeNull();
    expect(screen.queryByText(/^Assigned to/)).toBeNull();
  });
});

describe("TaskDetail description", () => {
  it("renders record text as text, never as markup", async () => {
    await openTask(TASK.result);

    expect(screen.getByText(/<b>Markup stays text\.<\/b>/)).toBeTruthy();
    expect(document.querySelector("main b")).toBeNull();
  });

  it("wraps a long description in full instead of scrolling inside the card", async () => {
    await openTask(TASK.long);
    const description = screen.getByText(/a-very-long-link-without-any-spaces/);

    expect(description.textContent).toBe(TASK.longDescription);
    expect(description.className).toContain("whitespace-pre-wrap");
    expect(description.className).toContain("break-words");
    for (
      let node: HTMLElement | null = description;
      node;
      node = node.parentElement
    ) {
      expect(node.className).not.toMatch(/overflow-|max-h-|line-clamp/);
    }
  });
});

describe("TaskDetail timeline", () => {
  it("stays collapsed until opened, and calls no tools", async () => {
    const sent = await openTask(TASK.result);

    expect(timelineButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Timeline" })).toBeNull();

    await openTimeline();

    expect(timelineButton().getAttribute("aria-expanded")).toBe("true");
    expect(timelineItems()).toHaveLength(4);
    expect(sent.calls).not.toHaveBeenCalled();
  });

  it("merges tasks_get's comments and Jobs by time, leaving out events without text", async () => {
    await openTask(TASK.result);
    await openTimeline();

    expect(timelineItems()).toEqual([
      expect.stringMatching(
        /^Ada Lovelace · Nov 21, 2026, 10:15 AMPlease include annual prices/,
      ),
      "Job · Nov 22, 2026, 9:30 AMCompetitor pricing scan · Failed",
      "Job · Nov 24, 2026, 2:00 PMCompetitor pricing scan, second try · Completed",
      expect.stringMatching(
        /^Market Analyst · Nov 24, 2026, 4:40 PMFirst pass/,
      ),
    ]);
  });

  it("closes again", async () => {
    await openTask(TASK.result);
    await openTimeline();
    await openTimeline();

    expect(timelineButton().getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Timeline" })).toBeNull();
  });

  it("says when there are no comments or Jobs", async () => {
    await openTask(TASK.bare);
    await openTimeline();

    expect(screen.getByText("No comments or Jobs yet")).toBeTruthy();
  });

  it("shows an archived Task's timeline, which tasks_get embeds too", async () => {
    await openTask(
      {
        ...TASK.result,
        structuredContent: {
          data: { ...TASK.task, archivedAt: "2026-11-24T09:00:00.000Z" },
        },
      },
      { serverTools: false },
    );
    await openTimeline();

    expect(timelineItems()).toHaveLength(4);
  });
});

describe("TaskDetail actions", () => {
  it("opens the Task in Sokosumi through the host", async () => {
    const sent = await openTask(TASK.result);

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Open in Sokosumi" })),
    );

    expect(sent.links).toHaveBeenCalledWith(
      `https://app.sokosumi.com/tasks/${TASK.task.id}`,
    );
  });

  it("sends a Task that waits for approval to Sokosumi, with no approve control", async () => {
    const sent = await openTask(TASK.approval);

    expect(screen.getByText("ACME-39 · Approval required")).toBeTruthy();
    await act(async () =>
      fireEvent.click(
        screen.getByRole("button", { name: "Review in Sokosumi" }),
      ),
    );
    expect(sent.links).toHaveBeenCalledWith(
      `https://app.sokosumi.com/tasks/${TASK.task.id}`,
    );
    expect(
      screen.queryByRole("button", { name: /approve|reject/i }),
    ).toBeNull();
  });

  it.each(["INPUT_REQUIRED", "AUTHENTICATION_REQUIRED", "OUT_OF_CREDITS"])(
    "asks for a review of a Task in %s, which waits on the person",
    async (status) => {
      await openTask({
        ...TASK.result,
        structuredContent: { data: { ...TASK.task, status } },
      });

      expect(screen.getByRole("button", { name: "Review in Sokosumi" }));
      expect(
        screen.queryByRole("button", { name: "Open in Sokosumi" }),
      ).toBeNull();
    },
  );

  it("offers no link without Core's Web base URL", async () => {
    await openTask({ ...TASK.result, _meta: {} });

    expect(
      screen.queryByRole("button", { name: "Open in Sokosumi" }),
    ).toBeNull();
  });

  it("refreshes the Task and an open timeline through the host", async () => {
    const refreshed = {
      ...TASK.result,
      structuredContent: {
        data: {
          ...TASK.task,
          name: "Research pricing, renamed",
          events: [
            ...TASK.task.events,
            {
              id: "evt_5",
              createdAt: "2026-11-25T08:00:00.000Z",
              comment: "Annual prices added.",
              status: null,
              actor: null,
            },
          ],
        },
      },
    };
    const sent = await openTask(TASK.result, {
      answer: async () => refreshed,
    });
    await openTimeline();

    await act(async () =>
      fireEvent.click(screen.getByRole("button", { name: "Refresh" })),
    );

    expect(sent.calls).toHaveBeenCalledWith("tasks_get", TASK.input);
    expect(sent.calls).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Research pricing, renamed",
    );
    expect(timelineItems().at(-1)).toBe(
      "Nov 25, 2026, 8:00 AMAnnual prices added.",
    );
  });
});
