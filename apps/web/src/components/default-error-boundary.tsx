"use client";

import * as Sentry from "@sentry/nextjs";
import { useTranslations } from "next-intl";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface DefaultErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  /**
   * Names the boundary in the Sentry `errorBoundary` tag and the console
   * prefix so a report points at the surface that threw (e.g. `chat`).
   */
  boundaryName?: string;
  /**
   * Extra Sentry context and console detail — e.g. `{ roomId }` — so the next
   * occurrence is diagnosable without another round trip.
   */
  context?: Record<string, unknown>;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
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

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Previously a no-op: the fallback (e.g. chat's "Chat Error" card) showed
    // the user nothing and reported nothing, so a render throw in one room was
    // undiagnosable. Send the error, the caught component stack, and any
    // caller context (the room id) to Sentry and the console instead.
    const boundaryName = this.props.boundaryName ?? "default";
    const context = this.props.context;
    if (typeof console !== "undefined") {
      console.error(`[${boundaryName}-error-boundary]`, error, context ?? {});
    }
    Sentry.captureException(error, {
      tags: { errorBoundary: boundaryName },
      contexts: { react: { componentStack: errorInfo.componentStack ?? "" } },
      ...(context ? { extra: context } : {}),
    });
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <DefaultErrorBoundaryError onRetry={this.reset} />
        )
      );
    }

    return this.props.children;
  }

  private reset = () => this.setState({ hasError: false });
}

export default DefaultErrorBoundary;

function DefaultErrorBoundaryError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations("Components.DefaultErrorBoundary");

  return (
    <div className="flex min-h-[120px] w-full flex-col items-center justify-center gap-3 rounded-md border border-semantic-destructive-tertiary bg-semantic-destructive-quinary p-4 text-center">
      <span className="text-lg text-semantic-destructive text-pretty">
        {t("error")}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={onRetry}>
        {t("tryAgain")}
      </Button>
    </div>
  );
}
