const USERSNAP_WIDGET_LOAD_FAILURE =
  "Failed to load the widget: Wrong API key or paused project";

/** Usersnap rejects with this message when the space key is invalid or paused. */
export function isUsersnapWidgetLoadFailure(value: unknown): boolean {
  if (typeof value === "string") {
    return value.includes(USERSNAP_WIDGET_LOAD_FAILURE);
  }

  if (value instanceof Error) {
    return value.message.includes(USERSNAP_WIDGET_LOAD_FAILURE);
  }

  return false;
}

export const USERSNAP_WIDGET_LOAD_FAILURE_MESSAGE =
  USERSNAP_WIDGET_LOAD_FAILURE;
