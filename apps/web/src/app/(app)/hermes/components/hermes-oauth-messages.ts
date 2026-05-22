type OAuthConnectReason =
  | "popup_blocked"
  | "popup_closed"
  | "timeout"
  | "error";

interface OAuthConnectTranslator {
  (key: "popupBlocked" | "popupClosed" | "timeout" | "connectFailed"): string;
}

export function hermesOAuthConnectErrorMessage(
  t: OAuthConnectTranslator,
  reason: OAuthConnectReason,
  message?: string,
): string {
  switch (reason) {
    case "popup_blocked":
      return t("popupBlocked");
    case "popup_closed":
      return t("popupClosed");
    case "timeout":
      return t("timeout");
    case "error":
      return message ?? t("connectFailed");
  }
}
