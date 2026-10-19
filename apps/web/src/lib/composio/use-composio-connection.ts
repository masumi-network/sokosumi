"use client";

import { useCallback } from "react";

import type { ActionResultDto } from "@/lib/actions/action-result";
import { completeComposioAuthCallbackAction } from "@/lib/actions/composio/action";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { useComposioOAuthPopup } from "@/lib/composio/use-composio-oauth-popup";

interface ComposioConnectionInitiation {
  connectionId: string;
  redirectUrl: string;
}

/** Where a failed connection stopped, so callers can word each failure. */
export type ComposioConnectionStage =
  | "initiate"
  | "provider_callback"
  | "legacy_callback"
  | "verify"
  | "finalize"
  | "unexpected";

export type ComposioConnectionOutcome<T> =
  | { kind: "connected"; value: T }
  | { kind: "cancelled" }
  | { kind: "timeout" }
  | { kind: "in_flight" }
  | { kind: "popup_blocked" }
  /** `error` is the failed action's error; null when no action failed. */
  | {
      kind: "failed";
      stage: ComposioConnectionStage;
      error: ActionError | null;
    };

interface ConnectOptions<T> {
  /** Runs once the popup is open, before anything else, for busy state. */
  onStart?: () => void;
  initiate: () => Promise<
    ActionResultDto<ComposioConnectionInitiation, ActionError>
  >;
  finalize: (connectionId: string) => Promise<ActionResultDto<T, ActionError>>;
}

/**
 * One Composio connection through the OAuth popup: initiate, send the popup to
 * the provider, wait for its callback, redeem the callback, then finalize.
 * Every way it can end comes back as an outcome, so callers only word them.
 */
export function useComposioConnection() {
  const { runPopupOAuth } = useComposioOAuthPopup();

  const connect = useCallback(
    async <T>({
      initiate,
      finalize,
      onStart,
    }: ConnectOptions<T>): Promise<ComposioConnectionOutcome<T>> => {
      const failed = (
        stage: ComposioConnectionStage,
        error: ActionError | null = null,
      ): ComposioConnectionOutcome<T> => ({ kind: "failed", stage, error });

      try {
        const run = await runPopupOAuth(
          async (flow): Promise<ComposioConnectionOutcome<T>> => {
            onStart?.();
            const initiation = await initiate();
            if (!initiation.ok) return failed("initiate", initiation.error);

            const { connectionId, redirectUrl } = initiation.value;
            flow.navigate(redirectUrl);
            const callback = await flow.waitForCallback();

            if (callback.kind === "cancelled") return { kind: "cancelled" };
            if (callback.kind === "timeout") return { kind: "timeout" };

            const { payload } = callback;
            if (payload.status === "error") return failed("provider_callback");
            if (payload.connectionId && payload.connectionId !== connectionId) {
              return failed("legacy_callback");
            }
            if (!payload.sessionUri) return failed("legacy_callback");

            const completion = await completeComposioAuthCallbackAction({
              connectionId,
              sessionUri: payload.sessionUri,
            });
            if (!completion.ok) return failed("verify", completion.error);

            const finalization = await finalize(connectionId);
            if (!finalization.ok) return failed("finalize", finalization.error);

            return { kind: "connected", value: finalization.value };
          },
        );

        return run.kind === "completed" ? run.value : { kind: run.kind };
      } catch {
        return failed("unexpected");
      }
    },
    [runPopupOAuth],
  );

  return { connect };
}
