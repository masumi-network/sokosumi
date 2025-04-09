"use client";

import { useTranslations } from "next-intl";
import { ErrorBoundary } from "react-error-boundary";
import { toast } from "sonner";

export default function JobInputsFormErrorWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  const t = useTranslations("Library.JobInput.Error");
  const handleError = () => {
    toast.error(t("failedToFetchJobInputSchema"));
  };

  return (
    <ErrorBoundary fallback={<JobInputsFormError />} onError={handleError}>
      {children}
    </ErrorBoundary>
  );
}

function JobInputsFormError() {
  const t = useTranslations("Library.JobInput.Error");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">
        {t("failedToFetchJobInputSchema")}
      </span>
    </div>
  );
}
