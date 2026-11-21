import { ForesightManager } from "js.foresight";

type ApproachKind = "mouse" | "tab" | "touch";

const SUB_TYPE: Record<ApproachKind, string | undefined> = {
  mouse: "trajectory",
  tab: "forwards",
  touch: undefined,
};

/** Where the cursor is when a mouse path reaches the element. */
type ApproachCursor = "keep" | "off-page" | { x: number; y: number };

/**
 * Run the library's own prediction for an element, as a cursor heading for it
 * does. happy-dom has no layout, so no pointer path can reach the element.
 * This calls the same internal step a path would: the names are the library's
 * and a version that renames them fails here, loudly.
 *
 * `kind` is what the library predicted from: a mouse path by default, or a
 * Tab stop close by, or a touch that starts on the element. For a mouse path,
 * `cursor` first moves the cursor onto the page (the default), off it, or
 * keeps where the test put it.
 *
 * Returns false when the element is not registered.
 */
export async function approachElement(
  element: Element,
  kind: ApproachKind = "mouse",
  cursor: ApproachCursor = { x: 1, y: 1 },
): Promise<boolean> {
  if (kind !== "mouse" || cursor === "keep") {
    // The cursor stays where the test put it.
  } else if (cursor === "off-page") {
    document.documentElement.dispatchEvent(
      new PointerEvent("pointerleave", { pointerType: "mouse" }),
    );
  } else {
    document.dispatchEvent(
      new PointerEvent("pointermove", {
        clientX: cursor.x,
        clientY: cursor.y,
        pointerType: "mouse",
      }),
    );
  }
  const manager = ForesightManager.instance;
  const entry = Reflect.get(manager, "elementEntries").get(element);
  if (!entry) return false;
  await Reflect.get(manager, "callCallback").call(manager, entry, {
    kind,
    subType: SUB_TYPE[kind],
  });
  return true;
}
