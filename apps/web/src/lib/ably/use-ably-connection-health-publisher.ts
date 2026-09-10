"use client";

import { useAbly } from "ably/react";
import { useEffect } from "react";

import { reportAblyConnectionConnected } from "./ably-connection-health-store";

/**
 * Mirror the shared Ably connection state into the SDK-free health store so
 * chat refresh consumers outside the Ably island can pick their cadence.
 * Auth success/failure is reported from the shared client's authCallback;
 * this hook only owns TCP `connected`. Every island calls this; the store
 * de-duplicates identical writes.
 */
export function useAblyConnectionHealthPublisher(): void {
  const ably = useAbly();

  useEffect(() => {
    const publish = () => {
      reportAblyConnectionConnected(ably.connection.state === "connected");
    };
    ably.connection.on(publish);
    publish();
    return () => {
      ably.connection.off(publish);
    };
  }, [ably]);
}
