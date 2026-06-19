import { useTranslations } from "next-intl";
import { useCallback } from "react";

export function getNotificationMessageTranslationKey(
  messageKey: string,
): string {
  if (messageKey.startsWith("Notifications.")) {
    return `Library.${messageKey}`;
  }

  return messageKey;
}

export function useNotificationMessage() {
  const t = useTranslations();

  return useCallback(
    (messageKey: string, messageParams: Record<string, unknown> = {}) => {
      try {
        return t(
          getNotificationMessageTranslationKey(messageKey) as never,
          messageParams as never,
        );
      } catch {
        return messageKey;
      }
    },
    [t],
  );
}
