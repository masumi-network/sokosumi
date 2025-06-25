import { useEffect, useRef } from "react";

import { payloadSchema, PayloadSchemaType } from "@/lib/db/listener/schema";

const MAX_RETRY_COUNT = 3;

export default function useJobStatusEvent(
  onEvent: (payload: PayloadSchemaType) => void,
) {
  const retryCountRef = useRef(0);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let isUnmounted = false;

    function connect() {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource("/api/stream/job-status");
      eventSourceRef.current = es;

      es.onopen = () => {
        retryCountRef.current = 0;
        console.log("✅ SSE connected");
      };

      es.onmessage = (payload) => {
        const { data } = payload;
        if (typeof data !== "string") return;
        try {
          const parsed = payloadSchema.parse(JSON.parse(data));
          if ("userId" in parsed) {
            onEvent(parsed);
          }
        } catch (error) {
          console.error("Failed to parse Job Status Event", error);
        }
      };

      es.onerror = (err) => {
        console.error("SSE error:", err);
        es.close();

        if (isUnmounted) return;

        retryCountRef.current += 1;
        if (retryCountRef.current <= MAX_RETRY_COUNT) {
          console.log(
            `🔄 Reconnecting SSE (attempt ${retryCountRef.current})...`,
          );
          setTimeout(connect, 2000 * retryCountRef.current);
        } else {
          console.warn("❌ Max retry count reached. SSE stopped.");
        }
      };
    }

    connect();

    return () => {
      isUnmounted = true;
      eventSourceRef.current?.close();
    };
  }, [onEvent]);
}
