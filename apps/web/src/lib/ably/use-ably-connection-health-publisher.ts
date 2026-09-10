"use client";

import { useAbly } from "ably/react";
import { useEffect } from "react";

import { setAblyConnectionHealthy } from "./ably-connection-health-store";

/**
 * Mirror the shared Ably connection state into the SDK-free health store so
 * chat refresh consumers outside the Ably island can pick their cadence.
 * Every island calls this; the store de-duplicates identical writes.
 */
export function useAblyConnectionHealthPublisher(): void {
  const ably = useAbly();

  useEffect(() => {
    const publish = () => {
      setAblyConnectionHealthy(ably.connection.state === "connected");
    };
    ably.connection.on(publish);
    publish();
    return () => {
      ably.connection.off(publish);
    };
  }, [ably]);
}
