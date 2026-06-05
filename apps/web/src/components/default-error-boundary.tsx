"use client";

import { useTranslations } from "next-intl";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface DefaultErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface DefaultErrorBoundaryState {
  hasError: boolean;
}

class DefaultErrorBoundary extends Component<
  DefaultErrorBoundaryProps,
  DefaultErrorBoundaryState
> {
  state: DefaultErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): DefaultErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo) {}

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultErrorBoundaryError />;
    }

    return this.props.children;
  }
}

export default DefaultErrorBoundary;

function DefaultErrorBoundaryError() {
  const t = useTranslations("Components.DefaultErrorBoundary");

  return (
    <div className="flex min-h-[120px] w-full items-center justify-center rounded-md border border-red-300 bg-red-50 p-4">
      <span className="text-lg text-red-500">{t("error")}</span>
    </div>
  );
}
