"use client";

import { useTranslations } from "next-intl";

import { ErrorState } from "@/components/common/error-state";
import { useErrorCardCopy } from "@/hooks/use-error-card-copy";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const auth = useTranslations("Auth.Error");
  const copy = useErrorCardCopy(error);

  return (
    <ErrorState
      description={copy.description}
      error={error}
      onRetry={reset}
      secondaryHref="/signin"
      secondaryLabel={auth("goLogin")}
      title={copy.title}
    />
  );
}
