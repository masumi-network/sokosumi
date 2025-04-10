"use client";

import { useTranslations } from "next-intl";
import { ErrorBoundary } from "react-error-boundary";

interface DefaultErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function DefaultErrorBoundary({
  children,
  fallback,
}: DefaultErrorBoundaryProps) {
  return (
    <ErrorBoundary fallback={fallback ?? <DefaultErrorBoundaryError />}>
      {children}
    </ErrorBoundary>
  );
}

function DefaultErrorBoundaryError() {
  const t = useTranslations("Components.DefaultErrorBoundary");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">{t("error")}</span>
    </div>
  );
}
