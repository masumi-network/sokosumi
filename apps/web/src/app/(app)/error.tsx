"use client";

import { useTranslations } from "next-intl";

import { ErrorState } from "@/components/common/error-state";
import { useUnAuthenticatedErrorHandler } from "@/hooks/effects/use-unauthenticated-error-handler";
import { useErrorCardCopy } from "@/hooks/use-error-card-copy";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("App.Error");
  const copy = useErrorCardCopy(error);
  const { renderIfAuthenticated } = useUnAuthenticatedErrorHandler(error);

  return renderIfAuthenticated(
    <ErrorState
      description={copy.description}
      error={error}
      onRetry={reset}
      secondaryHref="/"
      secondaryLabel={t("goApp")}
      title={copy.title}
    />,
  );
}
