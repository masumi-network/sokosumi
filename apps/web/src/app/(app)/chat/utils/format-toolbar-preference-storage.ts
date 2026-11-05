import {
  readStoredPreference,
  writeStoredPreference,
} from "@/lib/utils/preference-storage";

export const FORMAT_TOOLBAR_OPEN_STORAGE_KEY =
  "sokosumi:format-toolbar-open:v1" as const;

export function getFormatToolbarOpenPreference(): boolean | null {
  return readStoredPreference(FORMAT_TOOLBAR_OPEN_STORAGE_KEY, (raw) => {
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  });
}

export function setFormatToolbarOpenPreference(open: boolean): void {
  writeStoredPreference(
    FORMAT_TOOLBAR_OPEN_STORAGE_KEY,
    open ? "true" : "false",
  );
}
