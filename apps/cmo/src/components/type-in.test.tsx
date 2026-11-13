// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { LAND_MS, TYPE_IN_MS, TypeIn, useLanding } from "./type-in";

const media = { matches: false };
let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  media.matches = false;
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return media.matches;
    },
    addEventListener() {},
    removeEventListener() {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = (text: string) =>
  act(async () => root.render(<TypeIn text={text} />));
/** What the founder sees: the typing span while it types, else the text. */
const shown = () =>
  (host.querySelector('[aria-hidden="true"]') ?? host).textContent ?? "";
const caret = () => host.querySelector(".type-caret");
const wait = (ms: number) => act(async () => vi.advanceTimersByTime(ms));

it("shows text it mounts with at once, with no caret", async () => {
  await render("Reading fernhouse.co");
  expect(shown()).toBe("Reading fernhouse.co");
  expect(caret()).toBeNull();
  await wait(TYPE_IN_MS);
  expect(shown()).toBe("Reading fernhouse.co");
});

it("types new text in about a second, with a caret until it is done", async () => {
  await render("");
  await render("Reading fernhouse.co/about");
  expect(shown().length).toBeLessThan("Reading fernhouse.co/about".length);
  expect(caret()).not.toBeNull();
  await wait(TYPE_IN_MS / 2);
  expect(shown().length).toBeGreaterThan(0);
  expect(shown().length).toBeLessThan("Reading fernhouse.co/about".length);
  await wait(TYPE_IN_MS);
  expect(shown()).toBe("Reading fernhouse.co/about");
  expect(caret()).toBeNull();
});

it("gives screen readers the whole text while it types", async () => {
  await render("");
  await render("Studying rival.com");
  expect(host.querySelector(".ob-sr")?.textContent).toBe("Studying rival.com");
});

it("types only what was added to text already seen", async () => {
  await render("Reading fernhouse.co");
  await render("Reading fernhouse.co/about");
  expect(shown().startsWith("Reading fernhouse.co")).toBe(true);
  await wait(TYPE_IN_MS);
  expect(shown()).toBe("Reading fernhouse.co/about");
});

it("shows new text at once under reduced motion", async () => {
  media.matches = true;
  await render("");
  await render("Studying rival.com");
  expect(shown()).toBe("Studying rival.com");
  expect(caret()).toBeNull();
});

// Today: the month's pieces land one at a time.

function Count({ value }: { value: number }) {
  return <>{useLanding(value)}</>;
}

const count = (value: number) =>
  act(async () => root.render(<Count value={value} />));

it("lands a count it mounts with at once", async () => {
  await count(4);
  expect(host.textContent).toBe("4");
});

it("lands new pieces one at a time", async () => {
  await count(1);
  await count(4);
  expect(host.textContent).toBe("1");
  await wait(LAND_MS);
  expect(host.textContent).toBe("2");
  await wait(LAND_MS);
  expect(host.textContent).toBe("3");
  await wait(LAND_MS);
  expect(host.textContent).toBe("4");
  await wait(LAND_MS * 3);
  expect(host.textContent).toBe("4");
});

it("lands every new piece at once under reduced motion", async () => {
  media.matches = true;
  await count(1);
  await count(4);
  expect(host.textContent).toBe("4");
});
