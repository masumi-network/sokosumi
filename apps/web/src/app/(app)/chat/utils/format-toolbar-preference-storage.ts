export const FORMAT_TOOLBAR_OPEN_STORAGE_KEY =
  "sokosumi:format-toolbar-open:v1" as const;

export interface ResolveFormatToolbarOpenOnMountInput {
  stored: boolean | null;
  viewportWidth: number;
  mobileBreakpoint: number;
}

export function getFormatToolbarOpenPreference(): boolean | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const raw = window.localStorage.getItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY);
    if (raw === "true") {
      return true;
    }
    if (raw === "false") {
      return false;
    }
    if (raw != null) {
      window.localStorage.removeItem(FORMAT_TOOLBAR_OPEN_STORAGE_KEY);
    }
    return null;
  } catch {
    return null;
  }
}

export function setFormatToolbarOpenPreference(open: boolean): void {
  try {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      FORMAT_TOOLBAR_OPEN_STORAGE_KEY,
      open ? "true" : "false",
    );
  } catch {
    // Best-effort: quota / private mode must not break compose.
  }
}

export function resolveFormatToolbarOpenOnMount(
  input: ResolveFormatToolbarOpenOnMountInput,
): boolean {
  if (input.stored !== null) {
    return input.stored;
  }
  return input.viewportWidth >= input.mobileBreakpoint;
}
