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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB } from "../../../harness/fixtures.ts";
import { Shell } from "../../shell/Shell.tsx";
import { JobResult, JobStatus } from "./JobStatus.tsx";

/** A fake host that answers the view's tool calls with `answer`. */
async function openJob(
  result: CallToolResult,
  answer: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<CallToolResult> = async () => result,
  { serverTools = true } = {},
) {
  const [hostSide, viewSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(
    null,
    { name: "test-host", version: "1.0.0" },
    { openLinks: {}, ...(serverTools && { serverTools: {} }) },
    { hostContext: { locale: "en-US", timeZone: "Europe/Berlin" } },
  );
  const sent = { links: vi.fn(), calls: vi.fn() };
  bridge.onopenlink = async ({ url }) => {
    sent.links(url);
    return {};
  };
  bridge.oncalltool = async ({ name, arguments: args }) => {
    sent.calls(name, args);
    return answer(name, args);
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
      schema={JobResult}
      refreshTool="jobs_get"
    >
      {(data, context) => <JobStatus data={data} context={context} />}
    </Shell>,
  );
  await act(() => initialized);
  await act(() => bridge.sendToolInput({ arguments: JOB.input }));
  await act(() => bridge.sendToolResult(result));
  return { bridge, sent };
}

/** Runs the poll timers `ms` ahead and lets the host round trip settle. */
const advance = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

const status = () => screen.getByRole("status");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("JobStatus", () => {
  it("shows a running Job: its name, agent, status in words and start time", async () => {
    await openJob(JOB.running);

    expect(
      screen.getByRole("heading", { name: "Competitor pricing in DACH" }),
    ).toBeTruthy();
    expect(screen.getByText("Market Research")).toBeTruthy();
    expect(within(status()).getByText("Working")).toBeTruthy();
    expect(
      within(status()).getByText(
        "The agent is working on it. This view updates while it is open.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Nov 25, 2026, 10:00 AM")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Result" })).toBeNull();
    // No remote images, not even the agent's icon (ADR 0083).
    expect(document.querySelector("img")).toBeNull();
  });

  it("polls jobs_get with the call's arguments and stops once the Job finishes", async () => {
    const answers = [JOB.running, JOB.completed];
    const { sent } = await openJob(JOB.running, async () =>
      answers.length > 1 ? (answers.shift() as CallToolResult) : answers[0],
    );

    await advance(3000);
    expect(sent.calls).toHaveBeenCalledTimes(1);
    expect(sent.calls).toHaveBeenLastCalledWith("jobs_get", JOB.input);
    expect(within(status()).getByText("Working")).toBeTruthy();

    await advance(5000);
    expect(sent.calls).toHaveBeenCalledTimes(2);
    expect(within(status()).getByText("Completed")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Result" })).toBeTruthy();

    await advance(60_000);
    expect(sent.calls).toHaveBeenCalledTimes(2);
  });

  it("does not claim to update on a host that cannot call server tools", async () => {
    const { sent } = await openJob(JOB.running, undefined, {
      serverTools: false,
    });

    expect(
      within(status()).getByText("The agent is working on it."),
    ).toBeTruthy();
    expect(screen.queryByText(/This view updates/)).toBeNull();
    await advance(60_000);
    expect(sent.calls).not.toHaveBeenCalled();
  });

  it("does not poll a finished Job", async () => {
    const { sent } = await openJob(JOB.failed);

    expect(within(status()).getByText("Failed")).toBeTruthy();
    expect(
      within(status()).getByText("The Job could not be completed."),
    ).toBeTruthy();
    await advance(60_000);
    expect(sent.calls).not.toHaveBeenCalled();
  });

  it("shows a completed Job's result as plain text", async () => {
    await openJob(JOB.completed);

    const result = screen.getByRole("region", { name: "Result" });
    expect(result.textContent).toContain("# DACH pricing summary");
    expect(result.textContent).toContain(
      '<script>alert("record text stays text")</script>',
    );
    expect(document.querySelector("main script")).toBeNull();
    expect(screen.getByText("Nov 25, 2026, 10:12 AM")).toBeTruthy();
  });

  it("names files and links as text and opens none of them (ADR 0083)", async () => {
    const { sent } = await openJob(JOB.completed);

    const files = screen.getByRole("region", { name: "Files" });
    expect(within(files).getByText("dach-pricing-report.pdf")).toBeTruthy();
    expect(within(files).getByText("prices.csv")).toBeTruthy();
    const links = screen.getByRole("region", { name: "Links" });
    expect(within(links).getByText("Competitor A pricing")).toBeTruthy();
    expect(within(links).getByText("javascript:alert(1)")).toBeTruthy();
    expect(
      screen.getByText("Open the Job in Sokosumi to open its files and links."),
    ).toBeTruthy();

    // The only control that leaves the view is Open in Sokosumi.
    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Open in Sokosumi"]);
    expect(document.querySelector("a[href]")).toBeNull();
    await advance(0);
    expect(sent.links).not.toHaveBeenCalled();
  });

  it("opens the Job in Sokosumi under Core's webBaseUrl", async () => {
    const { sent } = await openJob(JOB.completed);

    fireEvent.click(screen.getByRole("button", { name: "Open in Sokosumi" }));
    await advance(0);
    expect(sent.links).toHaveBeenCalledWith(
      "https://app.sokosumi.com/agents/agent_research/jobs/cmi4gmksz000104l8wps8p7fp",
    );
  });

  it("tells the person to add the jobs toolset when jobs_get is unknown, and stops polling", async () => {
    const { sent } = await openJob(JOB.running, async () => {
      throw new Error("MCP error -32602: Unknown tool: jobs_get");
    });

    await advance(3000);
    expect(sent.calls).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText("Turn on the jobs toolset to follow this Job"),
    ).toBeTruthy();
    expect(
      screen.getByText(/\?toolsets=workspaces,tasks,coworkers,jobs/),
    ).toBeTruthy();
    // The last result stays, without claiming it still updates.
    expect(within(status()).getByText("Working")).toBeTruthy();
    expect(
      within(status()).getByText("The agent is working on it."),
    ).toBeTruthy();

    await advance(60_000);
    expect(sent.calls).toHaveBeenCalledTimes(1);
  });

  const coreError = (status: number, message: string): CallToolResult => ({
    content: [{ type: "text", text: JSON.stringify({ status, message }) }],
    structuredContent: { status, message },
    isError: true,
  });

  it.each([
    [404, "Job not found"],
    [403, "Forbidden"],
  ])(
    "says the Job is not available anymore on a %i, and stops polling",
    async (code, message) => {
      const { sent } = await openJob(JOB.running, async () =>
        coreError(code, message),
      );

      await advance(3000);
      expect(screen.getByText("This Job isn't available anymore")).toBeTruthy();
      expect(screen.queryByText(/Trying again/)).toBeNull();
      expect(screen.queryByText(/This view updates/)).toBeNull();

      await advance(60_000);
      expect(sent.calls).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    [429, "Too many requests"],
    [500, "Something went wrong"],
  ])("keeps retrying after a %i", async (code, message) => {
    const { sent } = await openJob(JOB.running, async () =>
      coreError(code, message),
    );

    await advance(3000);
    expect(
      screen.getByText("Could not check for updates. Trying again."),
    ).toBeTruthy();
    expect(screen.queryByText("This Job isn't available anymore")).toBeNull();
    await advance(5000);
    expect(sent.calls).toHaveBeenCalledTimes(2);
  });

  it("says when a check failed and keeps the last result", async () => {
    const { sent } = await openJob(JOB.running, async () => {
      throw new Error("Network down");
    });

    await advance(3000);
    expect(
      screen.getByText("Could not check for updates. Trying again."),
    ).toBeTruthy();
    expect(within(status()).getByText("Working")).toBeTruthy();
    await advance(5000);
    expect(sent.calls).toHaveBeenCalledTimes(2);
  });

  describe("input request (SOKD-423)", () => {
    /** Answers each tool by name; `jobs_get` defaults to the input Job. */
    const host =
      (answers: Record<string, () => Promise<CallToolResult>>) =>
      (name: string) =>
        (answers[name] ?? (async () => JOB.inputRequired))();

    const openRequest = (
      answers: Record<string, () => Promise<CallToolResult>> = {},
    ) =>
      openJob(
        JOB.inputRequired,
        host({
          jobs_input_request: async () => JOB.inputRequest,
          jobs_input: async () => JOB.inputSent,
          ...answers,
        }),
      );

    const send = () =>
      fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    const audience = () =>
      screen.getByRole("textbox", { name: /^Audience/ }) as HTMLInputElement;

    it("loads the request with jobs_input_request and shows its question and fields", async () => {
      const { sent } = await openRequest();
      await advance(0);

      expect(sent.calls).toHaveBeenCalledWith("jobs_input_request", {
        id: "cmi4gmksz000104l8wps8p7fp",
        workspace: "acme",
      });
      expect(within(status()).getByText("Waiting for your input")).toBeTruthy();
      expect(
        screen.getByText(
          "Who reads the summary, and which tone fits them? <b>Markup stays text.</b>",
        ),
      ).toBeTruthy();
      expect(audience()).toBeTruthy();
      expect(screen.getByRole("radio", { name: "Formal" })).toBeTruthy();
      expect(document.querySelector("main b")).toBeNull();
    });

    it("does not poll while the person answers", async () => {
      const { sent } = await openRequest();
      await advance(60_000);

      expect(sent.calls).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/This view updates/)).toBeNull();
    });

    it("sends the answer with the request's eventId, then polls again and shows the new status", async () => {
      const { sent } = await openRequest({
        jobs_get: async () => JOB.running,
      });
      await advance(0);

      fireEvent.change(audience(), {
        target: { value: "Founders in Germany" },
      });
      fireEvent.click(screen.getByRole("radio", { name: "Friendly" }));
      send();
      await advance(0);

      const answer = sent.calls.mock.calls.find(
        ([name]) => name === "jobs_input",
      );
      // The eventId is the one jobs_input_request returned.
      expect(JOB.inputRequest.structuredContent).toMatchObject({
        data: { eventId: "event_awaiting_input" },
      });
      expect(answer?.[1]).toEqual({
        id: "cmi4gmksz000104l8wps8p7fp",
        workspace: "acme",
        body: {
          eventId: "event_awaiting_input",
          inputData: { audience: "Founders in Germany", tone: [1] },
        },
      });

      // Refreshes at once, and the new status replaces the form.
      expect(sent.calls).toHaveBeenLastCalledWith("jobs_get", JOB.input);
      expect(within(status()).getByText("Working")).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
    });

    it("keeps saying the answer was sent while Core still waits for the agent", async () => {
      const { sent } = await openRequest({
        jobs_get: async () => JOB.inputAnswered,
      });
      await advance(0);
      fireEvent.change(audience(), {
        target: { value: "Founders in Germany" },
      });
      send();
      await advance(0);

      expect(
        screen.getByText("Answer sent. The agent continues from here."),
      ).toBeTruthy();
      expect(screen.queryByRole("textbox")).toBeNull();
      // Polling is back on.
      const before = sent.calls.mock.calls.length;
      await advance(3000);
      expect(sent.calls.mock.calls.length).toBe(before + 1);
      expect(
        sent.calls.mock.calls.filter(([name]) => name === "jobs_input_request"),
      ).toHaveLength(1);
    });

    it("sends once: the button is disabled while the answer is in flight", async () => {
      const { sent } = await openRequest({
        jobs_input: () => new Promise<CallToolResult>(() => {}),
      });
      await advance(0);
      fireEvent.change(audience(), {
        target: { value: "Founders in Germany" },
      });

      const button = screen.getByRole("button", { name: "Send answer" });
      fireEvent.click(button);
      fireEvent.click(button);
      await advance(0);

      expect(button.textContent).toBe("Sending");
      expect((button as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(button);
      await advance(0);
      expect(
        sent.calls.mock.calls.filter(([name]) => name === "jobs_input"),
      ).toHaveLength(1);
    });

    it("shows validation errors per field and sends nothing", async () => {
      const { sent } = await openRequest();
      await advance(0);

      send();
      await advance(0);

      expect(screen.getByText("Required.")).toBeTruthy();
      expect(audience().getAttribute("aria-invalid")).toBe("true");
      expect(
        sent.calls.mock.calls.filter(([name]) => name === "jobs_input"),
      ).toHaveLength(0);
    });

    it("shows Core's refusal near the button and keeps the answer", async () => {
      const { sent } = await openRequest({
        jobs_input: async () => JOB.inputRefused,
      });
      await advance(0);
      fireEvent.change(audience(), {
        target: { value: "Founders in Germany" },
      });

      send();
      await advance(0);

      expect(
        screen.getByText("The agent could not accept this input"),
      ).toBeTruthy();
      expect(audience().value).toBe("Founders in Germany");
      const button = screen.getByRole("button", {
        name: "Send answer",
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);

      // Trying again sends again.
      send();
      await advance(0);
      expect(
        sent.calls.mock.calls.filter(([name]) => name === "jobs_input"),
      ).toHaveLength(2);
    });

    it("says the answer did not go through when the call fails, and keeps it", async () => {
      await openRequest({
        jobs_input: async () => {
          throw new Error("Network down");
        },
      });
      await advance(0);
      fireEvent.change(audience(), {
        target: { value: "Founders in Germany" },
      });

      send();
      await advance(0);

      expect(
        screen.getByText("Could not send your answer. Try again."),
      ).toBeTruthy();
      expect(audience().value).toBe("Founders in Germany");
    });

    it.each([
      [
        "Core has no request",
        async (): Promise<CallToolResult> => ({
          content: [{ type: "text", text: "No input request found" }],
          structuredContent: { status: 404, message: "No input request found" },
          isError: true,
        }),
      ],
      [
        "the schema is not JSON",
        async (): Promise<CallToolResult> => ({
          content: [],
          structuredContent: {
            data: { eventId: "event_1", inputSchema: "not json" },
          },
        }),
      ],
      [
        "the call fails",
        async (): Promise<CallToolResult> => {
          throw new Error("MCP error -32602: Unknown tool: jobs_input_request");
        },
      ],
    ])(
      "points to the chat and Sokosumi when %s, and keeps polling",
      async (_, request) => {
        const { sent } = await openRequest({ jobs_input_request: request });
        await advance(0);

        expect(
          screen.getByText(
            "Answer its question in the chat, or open the Job in Sokosumi.",
          ),
        ).toBeTruthy();
        expect(screen.queryByRole("textbox")).toBeNull();
        await advance(3000);
        expect(sent.calls).toHaveBeenLastCalledWith("jobs_get", JOB.input);
      },
    );

    it("reads a schema sent as a bare list of fields", async () => {
      await openRequest({
        jobs_input_request: async () => ({
          content: [],
          structuredContent: {
            data: {
              eventId: "event_1",
              inputSchema: JSON.stringify([
                { id: "budget", type: "number", name: "Budget" },
              ]),
            },
          },
        }),
      });
      await advance(0);

      expect(screen.getByRole("spinbutton", { name: "Budget" })).toBeTruthy();
    });

    it("points to the chat on a host that cannot call server tools", async () => {
      const { sent } = await openJob(JOB.inputRequired, undefined, {
        serverTools: false,
      });
      await advance(0);

      expect(
        screen.getByText(
          "Answer its question in the chat, or open the Job in Sokosumi.",
        ),
      ).toBeTruthy();
      expect(sent.calls).not.toHaveBeenCalled();
    });
  });
});
