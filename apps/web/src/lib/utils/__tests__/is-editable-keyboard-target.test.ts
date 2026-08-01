import { describe, expect, it } from "vitest";

import { isEditableKeyboardTarget } from "@/lib/utils/is-editable-keyboard-target";

describe("isEditableKeyboardTarget", () => {
  it("returns false for null and non-elements", () => {
    expect(isEditableKeyboardTarget(null)).toBe(false);
    expect(isEditableKeyboardTarget(document.createTextNode("x"))).toBe(false);
  });

  it("returns true for input, textarea, and select", () => {
    expect(isEditableKeyboardTarget(document.createElement("input"))).toBe(
      true,
    );
    expect(isEditableKeyboardTarget(document.createElement("textarea"))).toBe(
      true,
    );
    expect(isEditableKeyboardTarget(document.createElement("select"))).toBe(
      true,
    );
  });

  it("returns true for contentEditable elements (chat composer)", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    expect(isEditableKeyboardTarget(editor)).toBe(true);
  });

  it("returns true for descendants of contentEditable", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    const child = document.createElement("strong");
    editor.appendChild(child);
    document.body.appendChild(editor);
    expect(isEditableKeyboardTarget(child)).toBe(true);
    editor.remove();
  });

  it("returns false for ordinary buttons and links", () => {
    expect(isEditableKeyboardTarget(document.createElement("button"))).toBe(
      false,
    );
    expect(isEditableKeyboardTarget(document.createElement("a"))).toBe(false);
  });
});
