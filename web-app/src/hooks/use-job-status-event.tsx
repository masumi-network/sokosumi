import { useEffect } from "react";

import { payloadSchema, PayloadSchemaType } from "@/lib/db/listener/schema";

export default function useJobStatusEvent(
  onEvent: (payload: PayloadSchemaType) => void,
) {
  useEffect(() => {
    const eventSource = new EventSource("/api/stream/job-status");

    eventSource.onmessage = (payload) => {
      const { data } = payload;
      if (typeof data !== "string") return;
      try {
        const parsed = payloadSchema.parse(JSON.parse(data));
        onEvent(parsed);
      } catch (error) {
        console.error("Failed to parse Job Status Event", error);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [onEvent]);
}
