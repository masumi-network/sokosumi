// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { type CusoRig, startCusoRig } from "./cuso-rig";

const POSES = readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../public/cuso/poses.svg",
  ),
  "utf8",
);

let host: HTMLElement;
let rig: CusoRig;

const shown = () =>
  [...host.querySelectorAll<SVGElement>("svg[data-pose]")]
    .filter((el) => el.style.visibility === "visible")
    .map((el) => el.dataset.pose);

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });
  host = document.createElement("span");
  host.innerHTML = `<span class="cuso-shadow"></span>${POSES}`;
  document.body.append(host);
  rig = startCusoRig(
    host.lastElementChild as SVGSVGElement,
    host.querySelector(".cuso-shadow") as HTMLElement,
  );
});

afterEach(() => {
  rig.stop();
  host.remove();
  vi.useRealTimers();
});

it("shows his first pose at once, then changes pose at the bottom of a squash", async () => {
  rig.pose("pointing");
  expect(shown()).toEqual(["pointing"]);
  rig.pose("done");
  // He sinks first; the drawing changes where the motion hides the cut.
  expect(shown()).toEqual(["pointing"]);
  await vi.advanceTimersByTimeAsync(400);
  expect(shown()).toEqual(["done"]);
});

it("walks in with his legs drawn live", async () => {
  rig.pose("done");
  rig.pose("walking");
  await vi.advanceTimersByTimeAsync(300);
  expect(shown()).toEqual(["walking"]);
  const legs = [...host.querySelectorAll("[data-leg] [data-tube]")];
  expect(legs.length).toBe(4);
  for (const tube of legs) expect(tube.getAttribute("d")).toMatch(/^M[\d.-]+ /);
});

it("stops moving once stopped", async () => {
  rig.pose("pointing");
  rig.stop();
  rig.pose("done");
  await vi.advanceTimersByTimeAsync(1000);
  expect(shown()).toEqual(["pointing"]);
});
