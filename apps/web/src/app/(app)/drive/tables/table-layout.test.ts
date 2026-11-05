import { describe, expect, it } from "vitest";
import { cellWrap, columnWidth } from "./table-layout";

describe("column width", () => {
  it("uses the saved width, else the type's default", () => {
    expect(columnWidth({ type: "text", width: 312 })).toBe(312);
    expect(columnWidth({ type: "long_text", width: null })).toBe(320);
    expect(columnWidth({ type: "number", width: null })).toBe(120);
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
