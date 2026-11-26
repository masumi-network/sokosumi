"use client";

import { useEffect } from "react";

/**
 * Toggles `data-agent-fullbleed="true"` on `<body>` while the agent jobs
 * segment is mounted.
 */
export function useAgentFullbleedBody(): void {
  useEffect(() => {
    document.body.dataset.agentFullbleed = "true";
    return () => {
      delete document.body.dataset.agentFullbleed;
    };
  }, []);
}
