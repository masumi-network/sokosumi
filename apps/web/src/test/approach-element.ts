import { ForesightManager } from "js.foresight";

/**
 * Run the library's own prediction for an element, as a cursor heading for it
 * does. happy-dom has no layout, so no pointer path can reach the element.
 * This calls the same internal step a path would: the names are the library's
 * and a version that renames them fails here, loudly.
 *
 * Returns false when the element is not registered.
 */
export async function approachElement(element: Element): Promise<boolean> {
  const manager = ForesightManager.instance;
  const entry = Reflect.get(manager, "elementEntries").get(element);
  if (!entry) return false;
  await Reflect.get(manager, "callCallback").call(manager, entry, {
    kind: "mouse",
    subType: "trajectory",
  });
  return true;
}
