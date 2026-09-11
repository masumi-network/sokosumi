import { useTranslations } from "next-intl";

import { CORE_AUTH_UNAVAILABLE_ERROR_DIGEST } from "@/lib/auth/errors";

/**
 * Which `App.Error` copy an error boundary should show.
 *
 * A production build strips a server error to a generic `Error` plus its
 * digest, so the digest is the only thing a boundary can read to tell one
 * failure apart from another. A Core stall carries
 * `CORE_AUTH_UNAVAILABLE_ERROR_DIGEST` and gets copy that says so; everything
 * else keeps the generic "something went wrong" card.
 *
 * The buttons do not change. "Try again" is already the right action for a
 * stall, and it was only the sentence above it that was wrong.
 */
export function useErrorCardCopy(error: Error & { digest?: string }): {
  title: string;
  description: string;
} {
  const t = useTranslations("App.Error");
  const isCoreUnavailable = error.digest === CORE_AUTH_UNAVAILABLE_ERROR_DIGEST;

  return {
    title: isCoreUnavailable ? t("unavailableTitle") : t("title"),
    description: isCoreUnavailable
      ? t("unavailableDescription")
      : t("description"),
  };
}
