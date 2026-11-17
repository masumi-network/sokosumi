import { expect, it } from "vitest";

import { spreadPlayers } from "./market-map";

it("moves a dot that sits on another until both labels are clear", () => {
  const spread = spreadPlayers([
    { name: "Acme", x: 75, y: 80, you: true },
    { name: "Dropspot", x: 40, y: 10 },
    { name: "Canucks Publishing", x: 40, y: 10 },
  ]);
  const y = (name: string) => spread.find((p) => p.name === name)?.y;
  expect(y("Acme")).toBe(80);
  expect(y("Dropspot")).toBe(10);
  expect(y("Canucks Publishing")).toBe(17);
});

it("keeps the business in place and moves the competitor on it", () => {
  const spread = spreadPlayers([
    { name: "Rival", x: 75, y: 80 },
    { name: "Acme", x: 75, y: 80, you: true },
  ]);
  expect(spread.find((p) => p.name === "Acme")?.y).toBe(80);
  expect(spread.find((p) => p.name === "Rival")?.y).toBe(73);
});
