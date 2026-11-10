// @vitest-environment happy-dom

import type { CmoOverview } from "@sokosumi/core-client";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { cmoStrategyVersion } from "../../test-fixtures/cmo";
import { draft } from "../../test-fixtures/onboarding";
import { LaunchStep } from "./launch-step";

let root: Root;
let host: HTMLDivElement;
let assign: ReturnType<typeof vi.fn<(url: string | URL) => void>>;

const approved = () => draft(cmoStrategyVersion(new Date()));
const linkedIn = {
  id: "li",
  provider: "linkedin",
  handle: "acme",
  displayName: "Acme",
  status: "ACTIVE",
};

/** A popup window as `window.open` hands it back. */
function popupWindow() {
  return { location: { href: "" }, closed: false, close: vi.fn() };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  assign = vi.fn<(url: string | URL) => void>();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const text = () => host.textContent ?? "";

function connectButton(): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find(
    (element) => element.textContent === "Connect",
  );
  if (!found) throw new Error("No Connect button");
  return found;
}

const done = (result: string, origin = window.location.origin) =>
  act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        data: { type: "cmo-connect-done", result },
      }),
    );
  });

/** Launch as the flow runs it: a poll replaces the overview. */
function Harness({
  onConnect,
  poll,
}: {
  onConnect: (
    provider: string,
    from?: "onboarding" | "popup",
  ) => Promise<{ url: string | null; error: string | null }>;
  poll: () => CmoOverview;
}) {
  const [overview, setOverview] = useState(approved);
  return (
    <LaunchStep
      overview={overview}
      onConnect={onConnect}
      onConnectAds={async () => ({ url: null, error: null })}
      onReturn={async () => setOverview(poll())}
      onLaunch={async () => {}}
      onGoToday={() => {}}
    />
  );
}

async function renderLaunch() {
  const onConnect = vi.fn(async () => ({
    url: "https://connect.example/linkedin",
    error: null,
  }));
  const poll = vi.fn(() => approved());
  await act(async () =>
    root.render(<Harness onConnect={onConnect} poll={poll} />),
  );
  return { onConnect, poll };
}

it("connects in a popup and marks the account connected without a reload", async () => {
  const popup = popupWindow();
  const open = vi.fn(() => popup);
  vi.stubGlobal("open", open);
  const { onConnect, poll } = await renderLaunch();
  expect(text()).toContain("Connect LinkedIn or X to launch.");

  await act(async () => connectButton().click());

  // Opened in the click itself, so a popup blocker lets it through.
  expect(open).toHaveBeenCalledTimes(1);
  expect(onConnect).toHaveBeenCalledWith("linkedin", "popup");
  expect(popup.location.href).toBe("https://connect.example/linkedin");
  expect(assign).not.toHaveBeenCalled();

  poll.mockImplementation(() =>
    draft({ ...cmoStrategyVersion(new Date()), channels: [linkedIn] }),
  );
  await done("connected");

  expect(poll).toHaveBeenCalledTimes(1);
  expect(text()).toContain("@acme");
  expect(text()).not.toContain("to launch.");
  expect(assign).not.toHaveBeenCalled();

  // The window then closes itself: no second poll.
  popup.closed = true;
  await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
  expect(poll).toHaveBeenCalledTimes(1);
});

it("ignores a done message from another origin", async () => {
  vi.stubGlobal("open", () => popupWindow());
  const { poll } = await renderLaunch();
  await act(async () => connectButton().click());

  await done("connected", "https://evil.example");

  expect(poll).not.toHaveBeenCalled();
});

it("says so when the popup's connect did not finish", async () => {
  vi.stubGlobal("open", () => popupWindow());
  await renderLaunch();
  await act(async () => connectButton().click());

  await done("failed");

  expect(text()).toContain("That connection didn't finish. Try again.");
  expect(connectButton().disabled).toBe(false);
});

it("checks again once the founder closes the popup without finishing", async () => {
  vi.useFakeTimers();
  const popup = popupWindow();
  vi.stubGlobal("open", () => popup);
  const { poll } = await renderLaunch();
  await act(async () => connectButton().click());

  popup.closed = true;
  await act(async () => vi.advanceTimersByTime(1_000));

  expect(poll).toHaveBeenCalledTimes(1);
  expect(connectButton().disabled).toBe(false);
});

it("closes the popup when connecting cannot start", async () => {
  const popup = popupWindow();
  vi.stubGlobal("open", () => popup);
  const onConnect = vi.fn(async () => ({
    url: null,
    error: "Could not start connecting",
  }));
  await act(async () =>
    root.render(<Harness onConnect={onConnect} poll={approved} />),
  );

  await act(async () => connectButton().click());

  expect(popup.close).toHaveBeenCalled();
  expect(text()).toContain("Could not start connecting");
});

it("falls back to today's redirect when popups are blocked", async () => {
  vi.stubGlobal("open", () => null);
  const { onConnect } = await renderLaunch();

  await act(async () => connectButton().click());

  expect(onConnect).toHaveBeenCalledWith("linkedin", "onboarding");
  expect(assign).toHaveBeenCalledWith("https://connect.example/linkedin");
});
