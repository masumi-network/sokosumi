"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useTransition } from "react";

import { LoadErrorState } from "@/components/common/load-error-state";

export type SocialLoadErrorKind =
  | "drafts"
  | "attention"
  | "accounts"
  | "calendar"
  | "post"
  | "project";

/**
 * One part of Social could not load. Every part says so the same way and
 * retries by asking the server for the page again, so the rest of Social
 * keeps what it already shows.
 */
export function SocialLoadError({
  kind,
  variant,
  "data-testid": testId,
}: {
  kind: SocialLoadErrorKind;
  variant?: "card" | "banner";
  "data-testid"?: string;
}) {
  const t = useTranslations("App.Projects.SocialPosts.loadError");
  const router = useRouter();
  const [retrying, startTransition] = useTransition();

  return (
    <LoadErrorState
      data-testid={testId}
      description={t(kind === "project" ? "projectHelp" : "help")}
      retrying={retrying}
      retryLabel={t("tryAgain")}
      title={t(`title.${kind}`)}
      variant={variant}
      onRetry={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
    />
  );
}
