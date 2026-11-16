"use client";

import { useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { toActionRejectionError } from "@/lib/actions/errors/action-error";
import { finalizeSeoStatisticsAction } from "@/lib/actions/seo-connections/action";
import {
  COMPOSIO_OAUTH_MESSAGE_TYPE,
  getComposioOAuthBroadcastChannelName,
} from "@/lib/composio/oauth-popup-protocol";
import {
  readSeoConnectionHandoff,
  type SeoConnectionCallbackContext,
  seoConnectionErrorKey,
} from "@/lib/seo/connection-callback";

export function useSeoConnectionHandoff() {
  const [context, setContext] = useState<
    SeoConnectionCallbackContext | null | undefined
  >();
  const handoff = useRef<SeoConnectionCallbackContext | null | undefined>(
    undefined,
  );
  useMountEffect(() => {
    if (handoff.current === undefined) {
      handoff.current = readSeoConnectionHandoff(window.name);
      window.name = "";
    }
    setContext(handoff.current);
  });
  return context;
}

/** Native completion also works without popup storage, name, or an opener. */
export function useSeoConnectionCallback(
  context: SeoConnectionCallbackContext | null,
) {
  const [busy, setBusy] = useState(Boolean(context && !context.failed));
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(
    context?.failed ? "consentFailed" : context ? null : "invalidCallback",
  );
  const inFlight = useRef(false);
  const alive = useRef(true);
  async function complete() {
    if (!context || context.failed || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await finalizeSeoStatisticsAction({
        provider: context.provider,
        viewerId: context.viewerId,
        organizationId: context.organizationId,
        ...(context.connectionId ? { connectionId: context.connectionId } : {}),
        ...(context.sessionUri ? { sessionUri: context.sessionUri } : {}),
      });
      if (!alive.current) return;
      if (!result.ok) {
        setError(seoConnectionErrorKey(result.error));
        return;
      }
      if (result.value.status !== "connected") {
        setError("activationPending");
        return;
      }
      setConnected(true);
      if (!context.nonce) return;
      const payload = {
        type: COMPOSIO_OAUTH_MESSAGE_TYPE,
        nonce: context.nonce,
        status: "success",
        connectionId: context.connectionId,
        sessionUri: null,
        errorMessage: null,
      };
      let published = false;
      try {
        const channel = new BroadcastChannel(
          getComposioOAuthBroadcastChannelName(context.nonce),
        );
        channel.postMessage(payload);
        published = true;
        channel.close();
      } catch {
        // An ordinary tab keeps the completed native page and its Audit link.
      }
      try {
        if (window.opener) {
          window.opener.postMessage(payload, window.location.origin);
          published = true;
        }
      } catch {
        // OAuth may isolate the opener. Same-origin BroadcastChannel remains independent.
      }
      if (published) {
        try {
          window.close();
        } catch {
          // The completed page and Audit link remain when the browser refuses closure.
        }
      }
    } catch (error) {
      if (alive.current)
        setError(seoConnectionErrorKey(toActionRejectionError(error)));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useMountEffect(() => {
    alive.current = true;
    void complete();
    return () => {
      alive.current = false;
    };
  });
  const canRetry =
    error !== null &&
    ["activationPending", "temporarilyUnavailable", "connectFailed"].includes(
      error,
    );
  return { busy, connected, error, canRetry, complete };
}
