/** Minimal Context chip flags shared by create/edit forms and updateTask. */
export interface TaskContextAttachmentFlags {
  brand: { enabled: boolean };
  briefingEnabled: boolean;
  contextMdEnabled: boolean;
}

/** True when save will re-attach at least one Context file into the description. */
export function taskContextSelectionAttachesAnything(
  selection: TaskContextAttachmentFlags,
): boolean {
  return (
    selection.brand.enabled ||
    selection.briefingEnabled ||
    selection.contextMdEnabled
  );
}
