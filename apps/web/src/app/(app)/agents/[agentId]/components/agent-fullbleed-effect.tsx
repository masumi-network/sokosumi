"use client";

import { useEffect } from "react";

/**
 * Toggles `data-agent-fullbleed="true"` on `<body>` while the agent detail
 * segment is mounted. Global CSS keys off the body attribute (not `:has`) so
 * Next.js Activity / Instant Navigations cannot leave a hidden marker in the
 * tree that would keep gallery `main` padding at 0 after soft nav away.
 */
export default function AgentFullbleedEffect() {
  useEffect(() => {
    document.body.dataset.agentFullbleed = "true";
    return () => {
      delete document.body.dataset.agentFullbleed;
    };
  }, []);
  return null;
}
