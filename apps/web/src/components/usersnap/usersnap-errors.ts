export const USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE =
  "Failed to load the widget: Wrong API key or paused project";

export function isUsersnapWidgetLoadFailure(reason: unknown): boolean {
  if (typeof reason === "string") {
    return reason.includes(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE);
  }

  if (reason instanceof Error) {
    return reason.message.includes(USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE);
  }

  return false;
}
