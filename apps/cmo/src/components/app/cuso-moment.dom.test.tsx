// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { View } from "../../lib/views";
import type { CusoArt } from "../cuso";
import { MOMENT_MS, useCusoMoment } from "./cuso-status";

let container: HTMLDivElement;
let root: Root;
let shown: { art: CusoArt; moving: boolean } | null = null;

function Probe(props: { art: CusoArt; view: View; busy: boolean }) {
  shown = useCusoMoment(props.art, props.view, props.busy);
  return null;
}

function motion(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: reduced && query.includes("reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  motion(false);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const render = (art: CusoArt, view: View, busy = false) =>
  act(async () => root.render(<Probe art={art} view={view} busy={busy} />));

it("walks for a moment when the owner opens another page, then settles", async () => {
  await render("pointing", "today");
  expect(shown).toEqual({ art: "pointing", moving: false });
  await render("pointing", "calendar");
  expect(shown).toEqual({ art: "walking", moving: true });
  await act(async () => vi.advanceTimersByTime(MOMENT_MS.walking));
  expect(shown).toEqual({ art: "pointing", moving: false });
});

it("shows his check mark when his work just finished", async () => {
  await render("thinking", "chat", true);
  await render("done", "chat", false);
  expect(shown).toEqual({ art: "done", moving: true });
  await render("walking", "chat", false);
  expect(shown?.moving).toBe(true);
  await act(async () => vi.advanceTimersByTime(MOMENT_MS["done"]));
  expect(shown).toEqual({ art: "walking", moving: false });
});

it("keeps the pose of his state when the owner asks for less motion", async () => {
  motion(true);
  await render("pointing", "today");
  await render("pointing", "calendar");
  expect(shown).toEqual({ art: "pointing", moving: false });
});
