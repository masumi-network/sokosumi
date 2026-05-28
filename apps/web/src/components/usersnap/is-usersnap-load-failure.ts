const USERSNAP_LOAD_FAILURE_PREFIX = "Failed to load the widget";

export function isUsersnapLoadFailure(reason: unknown): boolean {
  if (reason instanceof Error) {
    return reason.message.includes(USERSNAP_LOAD_FAILURE_PREFIX);
  }

  return (
    typeof reason === "string" && reason.includes(USERSNAP_LOAD_FAILURE_PREFIX)
  );
}
