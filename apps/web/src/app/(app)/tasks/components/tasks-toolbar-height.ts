/**
 * The height the board's toolbar last had in this tab, at one window width.
 * Active filter chips, a saved view and translated labels can wrap the
 * toolbar to more rows than the loading skeleton can know, so the skeleton
 * reserves this height and the board does not drop when it arrives.
 */
const STORAGE_KEY = "tasks-toolbar-height";

export function rememberTasksToolbarHeight(height: number) {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ width: window.innerWidth, height }),
    );
  } catch {
    // No storage (private mode, blocked): the skeleton keeps its own height.
  }
}

export function readTasksToolbarHeight(): number | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null");
    return saved?.width === window.innerWidth &&
      typeof saved.height === "number"
      ? saved.height
      : null;
  } catch {
    return null;
  }
}
