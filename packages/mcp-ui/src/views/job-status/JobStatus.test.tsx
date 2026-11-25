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

/** A fake host that answers the view's `jobs_get` calls with `answer`. */
async function openJob(
  result: CallToolResult,
  answer: () => Promise<CallToolResult> = async () => result,
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
    return answer();
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

  it("opens https files and links through the host, and nothing else", async () => {
    const { sent } = await openJob(JOB.completed);

    fireEvent.click(
      screen.getByRole("button", { name: /dach-pricing-report\.pdf/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Competitor A pricing/ }),
    );
    await advance(0);
    expect(sent.links.mock.calls).toEqual([
      ["https://blob.sokosumi.com/jobs/report.pdf"],
      ["https://competitor.example.com/pricing"],
    ]);

    // A file without an https URL and a non-https link show as text only.
    expect(screen.getByText("prices.csv")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /prices\.csv/ })).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /javascript/ })).toBeNull();
  });

  it("opens the Job in Sokosumi under Core's webBaseUrl", async () => {
    const { sent } = await openJob(JOB.completed);

    fireEvent.click(screen.getByRole("button", { name: "Open in Sokosumi" }));
    await advance(0);
    expect(sent.links).toHaveBeenCalledWith(
      "https://app.sokosumi.com/agents/agent_research/jobs/cmi4gmksz000104l8wps8p7fp",
    );
  });

  it("says a Job waits for the person's input, with a hint, and keeps polling", async () => {
    const { sent } = await openJob(JOB.inputRequired);

    expect(within(status()).getByText("Waiting for your input")).toBeTruthy();
    expect(
      within(status()).getByText(/Answer its question in the chat/),
    ).toBeTruthy();
    // ADR 0077: no answer control in this view (SOKD-423).
    expect(screen.queryByRole("textbox")).toBeNull();
    await advance(3000);
    expect(sent.calls).toHaveBeenCalledTimes(1);
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
});
