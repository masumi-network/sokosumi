import { describe, expect, it } from "vitest";
import {
  cellWrap,
  clampColumnWidth,
  columnWidth,
  fitColumnWidth,
} from "./table-layout";

describe("column width", () => {
  it("uses the saved width, else the type's default", () => {
    expect(columnWidth({ type: "text", width: 312 })).toBe(312);
    expect(columnWidth({ type: "long_text", width: null })).toBe(320);
    expect(columnWidth({ type: "number", width: null })).toBe(120);
  });
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
});

describe("cell wrap", () => {
  it("clamps long text and clips the rest unless the column chooses", () => {
    expect(cellWrap({ type: "long_text", wrap: null })).toBe("clamp");
    expect(cellWrap({ type: "text", wrap: null })).toBe("clip");
    expect(cellWrap({ type: "text", wrap: true })).toBe("wrap");
    expect(cellWrap({ type: "long_text", wrap: false })).toBe("clip");
  });
});
