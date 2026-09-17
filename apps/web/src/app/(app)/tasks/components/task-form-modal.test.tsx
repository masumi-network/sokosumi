import { describe, expect, it } from "vitest";

import { isTaskFormPortalEventTarget } from "./task-form-modal";

describe("isTaskFormPortalEventTarget", () => {
  it("ignores clicks inside a task-form portal", () => {
    const portal = document.createElement("div");
    portal.setAttribute("data-task-form-portal", "");
    const button = document.createElement("button");
    portal.append(button);
    document.body.append(portal);

    const originalEvent = new PointerEvent("pointerdown", { bubbles: true });
    Object.defineProperty(originalEvent, "target", { value: button });

    expect(isTaskFormPortalEventTarget(originalEvent.target)).toBe(true);
    expect(isTaskFormPortalEventTarget(document.body)).toBe(false);

    portal.remove();
  });
});
