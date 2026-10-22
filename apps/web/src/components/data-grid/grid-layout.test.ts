import { describe, expect, it } from "vitest";
import { clampColumnWidth, fitColumnWidth, fitGridColumn } from "./grid-layout";

describe("grid column width", () => {
  it("keeps widths whole and between 80 and 800 pixels", () => {
    expect(clampColumnWidth(12)).toBe(80);
    expect(clampColumnWidth(5000)).toBe(800);
    expect(clampColumnWidth(201.6)).toBe(202);
  });

  it("fits to the widest content, capped so one value cannot take the screen", () => {
    expect(fitColumnWidth([120.2, 96])).toBe(121);
    expect(fitColumnWidth([20])).toBe(80);
    expect(fitColumnWidth([2000])).toBe(480);
    expect(fitColumnWidth([])).toBe(80);
  });

  it("has nothing to fit without a rendered grid", () => {
    expect(fitGridColumn(null, "name")).toBeNull();
  });
});
